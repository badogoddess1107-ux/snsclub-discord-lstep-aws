import { CONFIG, serverNameForStep } from './config.js';
import { postWebhook } from './discord.js';

/** 「曖昧」「未マッチ」限定で、指定Discordスレッドへメンション付きアラート */
export async function notifyManualAlert(row, status, matchResult) {
  if (status !== '曖昧' && status !== '未マッチ') return;
  if (!CONFIG.alertWebhook) return;

  const mention = `<@&${CONFIG.alertMentionId}>`;
  const joinTime = fmtJst(row.created_at);
  const urlName = String(row.uid || '').replace(/[{}｛｝【】]/g, '').replace(/\|/g, ' / ').trim();
  const sysName = (matchResult && matchResult.display_name) || urlName || '(取得できず)';
  const lineName = (matchResult && matchResult.line_name) || '(取得できず)';

  const head = status === '曖昧'
    ? '下記のお客様の名前が同姓同名が存在するため手動で対応をお願いします。'
    : '下記のお客様の名前の読み取りにエラーが発生したため手動で対応をお願いします。';

  const content = [
    mention,
    head,
    `1.ディスコード入室時間：${joinTime}`,
    `2.ディスコードID：${row.discord_user_id}`,
    `3.システム表示名（Lステップ）：${sysName}`,
    `4.LINE登録名（Lステップ）：${lineName}`,
    `（参考）Discord表示名：${row.discord_display_name || ''} / 入室サーバー：${serverNameForStep(row.step)}`,
  ].join('\n');

  const url = CONFIG.alertWebhook + (CONFIG.alertWebhook.includes('?') ? '&' : '?') + 'thread_id=' + CONFIG.alertThreadId;
  try {
    await postWebhook(url, {
      content: content.slice(0, 1900),
      allowed_mentions: { roles: [String(CONFIG.alertMentionId)] },
    });
  } catch (e) {
    console.error('手動アラート失敗', e.message);
  }
}

function fmtJst(v) {
  if (!v) return '(不明)';
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(v);
  }
}
