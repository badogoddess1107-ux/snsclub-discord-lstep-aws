// LINE送信ワーカーをローカルで1件試す（デプロイ前の確認用）。キューは使わない。
//
//   npm run session:login -- --local ./.local-storage          # 先にログイン（書き戻しと共用）
//   WRITEBACK_LOCAL_DIR=./.local-storage npm run send:local -- --name やまだゆり --mid 649421762907
//       → 検索・トークを開く・管理ID照合・本文入力まで行い、送信ボタンは押さない（入力欄は空に戻す）
//   ... npm run send:local -- --name <名前> --mid <管理ID> --send   → 本当に送る（テスト用の宛先で）
import { launchBrowser } from '../src/browser.js';
import { runSender } from '../src/sender.js';
import { storageFromEnv, makeRunId } from '../src/storage.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const name = arg('--name');
const mid = arg('--mid');
const send = process.argv.includes('--send');
const headed = process.argv.includes('--headed');
if (!name || !mid) {
  console.error('使い方: npm run send:local -- --name <生徒名> --mid <管理ID> [--send] [--headed]');
  process.exit(1);
}
const text = arg('--text') || `【テスト送信】1on1講師マッチングの送信テストです。\n2行目\n\n4行目`;
const storage = storageFromEnv(process.env);
const browser = await launchBrowser({ headless: !headed });
try {
  const res = await runSender({
    browser, storage, runId: makeRunId(), dryRun: !send, log: console.log,
    accountName: process.env.LSTEP_ACCOUNT_NAME || 'SnsClub運営',
    jobs: [{ jobId: 'LOCAL', manageId: mid, studentName: name, type: 'test', text }],
  });
  console.log(JSON.stringify(res, null, 2));
  process.exitCode = res.status === 'success' && res.results.every((r) => r.ok) ? 0 : 1;
} finally {
  await browser.close();
}
