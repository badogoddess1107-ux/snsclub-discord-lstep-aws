// Lambda エントリ: 5分ごとに EventBridge Scheduler から起動される（1on1講師マッチングの LINE 送信）。
// 送るものが無ければ Chromium を起動せずに終わる。
//
// 環境変数（template.yaml で注入）:
//   WRITEBACK_BUCKET      セッション（書き戻しバッチと共用）・スクリーンショットの保存先S3
//   SENDER_QUEUE_URL      GAS Web App の /exec URL
//   SENDER_QUEUE_TOKEN    GAS の LSTEP_WORKER_TOKEN と同じ値
//   LSTEP_LOGIN_URL / LSTEP_ACCOUNT_NAME / DISCORD_ALERT_*   書き戻しバッチと同じ
// 手動実行（検証）: aws lambda invoke --payload '{"dryRun":true}' ...  → 入力まで行い送信しない（ジョブは未送信に戻す）
import { launchBrowser } from './browser.js';
import { runSender } from './sender.js';
import { pullJobs, reportResults, releaseJobs } from './gasQueue.js';
import { storageFromEnv, makeRunId } from './storage.js';
import { notifyDiscord } from './notify.js';

const NEEDS_LOGIN_ALERT_KEY = 'sender/last_needs_login_alert.txt';

export async function handler(event = {}) {
  const env = process.env;
  const dryRun = event.dryRun === true;
  const logs = [];
  const log = (m) => { logs.push(m); console.log(m); };
  const url = env.SENDER_QUEUE_URL;
  const token = env.SENDER_QUEUE_TOKEN;
  if (!url || !token) {
    log('SENDER_QUEUE_URL / SENDER_QUEUE_TOKEN 未設定のため何もしません');
    return { statusCode: 200, body: JSON.stringify({ data: { status: 'not_configured' }, error: null }) };
  }

  const jobs = await pullJobs(url, token, 10);
  if (!jobs.length) return { statusCode: 200, body: JSON.stringify({ data: { status: 'no_jobs' }, error: null }) };

  const runId = makeRunId();
  const storage = storageFromEnv(env);
  log(`===== LINE送信 runId=${runId} jobs=${jobs.length} dryRun=${dryRun} =====`);
  let browser;
  let result;
  try {
    browser = await launchBrowser({ headless: true });
    result = await runSender({
      browser, storage, jobs, runId, dryRun, log,
      loginUrl: env.LSTEP_LOGIN_URL || undefined,
      accountName: env.LSTEP_ACCOUNT_NAME || '',
    });
  } catch (e) {
    log('❌ エラー: ' + e.message);
    result = { status: 'error', error: e.message, results: [] };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const done = new Set(result.results.map((r) => r.jobId));
  const untried = jobs.map((j) => j.jobId).filter((id) => !done.has(id));
  if (dryRun) {
    await releaseJobs(url, token, jobs.map((j) => j.jobId)); // 検証では送っていないので全部戻す
  } else {
    await reportResults(url, token, result.results.map(({ jobId, ok, error }) => ({ jobId, ok, error })));
    await releaseJobs(url, token, untried);
  }

  if (result.status === 'needs_login') {
    // 5分ごとに起動するため、通知は6時間に1回まで
    const last = await storage.get(NEEDS_LOGIN_ALERT_KEY).catch(() => null);
    if (!last || Date.now() - Number(last.toString()) > 6 * 3600 * 1000) {
      await notifyDiscord('sender_needs_login', { runId, count: jobs.length }, env);
      await storage.put(NEEDS_LOGIN_ALERT_KEY, String(Date.now()), 'text/plain').catch(() => {});
    }
  } else if (result.status === 'error') {
    await notifyDiscord('sender_error', { runId, error: result.error, bucket: env.WRITEBACK_BUCKET }, env);
  }
  log(`===== 終了 status=${result.status} 成功=${result.results.filter((r) => r.ok).length} 失敗=${result.results.filter((r) => !r.ok).length} 未実行=${untried.length} =====`);
  return {
    statusCode: result.status === 'error' ? 500 : 200,
    body: JSON.stringify({ data: { runId, status: result.status, results: result.results, logs }, error: result.error || null }),
  };
}
