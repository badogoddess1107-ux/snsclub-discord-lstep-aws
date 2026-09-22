// Lambda エントリ: 毎日22時(JST)に EventBridge Scheduler から起動される。
// 手動実行（検証）: aws lambda invoke --payload '{"dryRun":true}' ...
//
// 環境変数（template.yaml で注入）:
//   WRITEBACK_BUCKET            セッション・成果物の保存先S3
//   WRITEBACK_MAP_URL           管理ID,DiscordID を返す自スタックのAPI（/writeback?token=）
//   LSTEP_LOGIN_URL             既定 https://manager.linestep.net/
//   LSTEP_ACCOUNT_NAME          操作対象アカウント名（例 SnsClub運営）。ログイン後に違えば切り替える
//   WRITEBACK_DRY_RUN           '1' で常にDRY RUN（初回検証用）
//   DISCORD_ALERT_WEBHOOK_URL / DISCORD_ALERT_THREAD_ID / DISCORD_ALERT_MENTION_ID  通知先
import { launchBrowser } from './browser.js';
import { runWriteback } from './lstepFlow.js';
import { storageFromEnv, makeRunId, runPrefix, LATEST_KEY } from './storage.js';
import { notifyDiscord } from './notify.js';

export async function handler(event = {}) {
  const env = process.env;
  const runId = makeRunId();
  const dryRun = event.dryRun === true || env.WRITEBACK_DRY_RUN === '1';
  const confirmImport = event.confirmImport !== false; // 既定: 本番反映まで行う
  const logs = [];
  const log = (m) => { logs.push(m); console.log(m); };

  const storage = storageFromEnv(env);
  log(`===== 書き戻し開始 runId=${runId} dryRun=${dryRun} storage=${storage.describe()} =====`);

  let browser;
  let result;
  try {
    browser = await launchBrowser({ headless: true });
    result = await runWriteback({
      browser, storage, runId,
      mapUrl: env.WRITEBACK_MAP_URL,
      loginUrl: env.LSTEP_LOGIN_URL || undefined,
      accountName: env.LSTEP_ACCOUNT_NAME || '',
      dryRun, confirmImport, log,
    });
  } catch (e) {
    log('❌ エラー: ' + e.message);
    result = { status: 'error', error: e.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const summary = { runId, finishedAt: new Date().toISOString(), dryRun, ...result, logs };
  await storage.put(runPrefix(runId) + 'summary.json', JSON.stringify(summary, null, 2), 'application/json').catch(() => {});
  await storage.put(LATEST_KEY, JSON.stringify(summary, null, 2), 'application/json').catch(() => {});

  if (result.status === 'success') {
    await notifyDiscord('success', { runId, dryRun, ...(result.stats || {}) }, env);
  } else if (result.status === 'needs_login') {
    await notifyDiscord('needs_login', { runId }, env);
  } else {
    await notifyDiscord('error', { runId, error: result.error, bucket: env.WRITEBACK_BUCKET }, env);
  }

  log(`===== 終了 status=${result.status} =====`);
  return { statusCode: result.status === 'error' ? 500 : 200, body: JSON.stringify({ data: summary, error: result.error || null }) };
}
