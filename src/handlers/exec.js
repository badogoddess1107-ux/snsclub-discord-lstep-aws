import { randomUUID } from 'node:crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CONFIG, guildIdForStep, serverNameForStep } from '../lib/config.js';
import { buildAuthorizeUrl, exchangeCodeForToken, fetchDiscordUser, joinGuild } from '../lib/discord.js';
import { getMapping, putMapping } from '../lib/dynamo.js';
import { completeHtml, errorHtml } from '../lib/html.js';
import { logTap, markTapJoined } from '../lib/sink.js';

const lambda = new LambdaClient({});

const html = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body,
});
const redirect = (location) => ({ statusCode: 302, headers: { Location: location }, body: '' });

export async function handler(event) {
  const q = (event && event.queryStringParameters) || {};
  try {
    if (q.code) return await handleCallback(q);
    if (q.step) return await handleInitial(q);
    return html(400, errorHtml('リンクが無効です。Lステップから配信された正しいリンクをお使いください。'));
  } catch (e) {
    console.error('exec error', e);
    return html(500, errorHtml('予期せぬエラーが発生しました。お手数ですがLステップにご連絡ください。'));
  }
}

// 初回アクセス：step が正しければ OAuth へ（uid/mid は空でも可＝入室はブロックしない）
async function handleInitial(q) {
  const step = String(q.step);
  if (step !== CONFIG.STEP_SNSCLUB && step !== CONFIG.STEP_CLASSCHAT && step !== CONFIG.STEP_CLASSCHAT3) {
    return html(200, errorHtml(`ステップ指定が不正です（step=${step}）`));
  }
  const nonce = randomUUID();
  // URLタップを記録（「タップしたが入室できない人」を可視化するため。nonceで後の入室と紐付け）。
  // 失敗・タイムアウトしても入室はブロックしない（短タイムアウト）。
  try {
    await logTap({
      nonce,
      step,
      server: serverNameForStep(step),
      lstep_uid: q.uid || '',
      lstep_manage_id: q.mid || '',
      status: 'タップ・未入室',
      tapped_at: new Date().toISOString(),
    });
  } catch (e) { console.error('タップ記録失敗', e.message); }
  const stateObj = { uid: q.uid || '', mid: q.mid || '', step, nonce, ts: Date.now() };
  const state = Buffer.from(encodeURIComponent(JSON.stringify(stateObj))).toString('base64url');
  return redirect(buildAuthorizeUrl(state)); // API Gatewayはiframeされないので直接302でOK（GASより速い）
}

// OAuthコールバック：token交換→ユーザー取得→自動入室→保存→即マッチ非同期起動→完了画面
async function handleCallback(q) {
  let state;
  try {
    state = JSON.parse(decodeURIComponent(Buffer.from(q.state, 'base64url').toString()));
  } catch {
    return html(200, errorHtml('認証情報が破損しています。再度Lステップのリンクからやり直してください。'));
  }
  const { uid = '', mid = '', step, nonce = '' } = state;

  const tok = await exchangeCodeForToken(q.code);
  if (tok.error) { console.error('token', tok.error); return html(200, errorHtml('Discord認証に失敗しました。お手数ですが最初からやり直してください。')); }

  const userRes = await fetchDiscordUser(tok.data.access_token);
  if (userRes.error) return html(200, errorHtml('Discordアカウント情報の取得に失敗しました。'));
  const user = userRes.data;

  const guildId = guildIdForStep(step);
  const join = await joinGuild(guildId, user.id, tok.data.access_token);
  if (!join.ok) {
    console.error('guilds.join失敗', join.error);
    return html(200, errorHtml(`Discordサーバーへの自動入室に失敗しました。サポートまでご連絡ください。（エラーコード: ${join.statusCode || 'unknown'}）`));
  }

  const displayName = user.global_name || user.username || '';
  const now = new Date().toISOString();
  const existing = await getMapping(user.id, step);
  await putMapping({
    discord_user_id: String(user.id),
    step: String(step),
    lstep_uid: uid,
    lstep_manage_id: mid || (existing && existing.lstep_manage_id) || '',
    lstep_line_name: (existing && existing.lstep_line_name) || '',
    lstep_real_name: (existing && existing.lstep_real_name) || '',
    lstep_display_name: (existing && existing.lstep_display_name) || '',
    discord_username: user.username,
    discord_display_name: displayName,
    discord_server: serverNameForStep(step),
    match_status: '処理中',
    match_confidence: '',
    created_at: (existing && existing.created_at) || now,
    updated_at: now,
  });

  // タップ追跡を「入室済み」に更新（nonceで紐付け。失敗しても本処理に影響させない）
  if (nonce) {
    try {
      await markTapJoined({ nonce, discord_user_id: String(user.id), joined_at: now });
    } catch (e) { console.error('タップ入室更新失敗', e.message); }
  }

  // 即マッチを非同期起動（完了画面は待たせない＝GASの1分ポーリングを撤廃）
  if (CONFIG.matchFunctionName) {
    try {
      await lambda.send(new InvokeCommand({
        FunctionName: CONFIG.matchFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ discord_user_id: String(user.id), step: String(step) })),
      }));
    } catch (e) {
      console.error('matchFunction 起動失敗', e.message);
    }
  }

  return html(200, completeHtml(step));
}
