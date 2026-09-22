// Lステップのログインセッションを作り直す（人が画像認証を解く工程）。
//
// 使い方（担当者の手元PCで。AWS認証情報が設定済みであること）:
//   npm install
//   npx playwright install chromium          # 初回のみ
//   WRITEBACK_BUCKET=<バケット名> npm run session:login
//     または  npm run session:login -- --bucket <バケット名>
//
// 流れ:
//   1. ブラウザが開く → Lステップにログイン（画像認証を解く）
//   2. ログインを検知すると Cookie 等を取り出して S3 の session/storageState.json に保存
//   3. 翌日22時の自動実行から、このセッションで動く
//
// このスクリプトはパスワードを一切扱わない（ブラウザで人が入力するだけ）。
import { chromium } from 'playwright';
import { storageFromEnv, saveSession } from '../src/storage.js';
import { ensureAccount, readHeaderText } from '../src/lstepFlow.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const bucket = arg('--bucket') || process.env.WRITEBACK_BUCKET;
const localDir = arg('--local') || process.env.WRITEBACK_LOCAL_DIR;
const loginUrl = process.env.LSTEP_LOGIN_URL || 'https://manager.linestep.net/';
const accountName = process.env.LSTEP_ACCOUNT_NAME || 'SnsClub運営';

if (!bucket && !localDir) {
  console.error('❌ 保存先が未指定です。 --bucket <S3バケット名> か WRITEBACK_BUCKET を指定してください。');
  console.error('   バケット名は sam deploy の出力 WritebackBucketName に表示されます。');
  process.exit(1);
}
const storage = storageFromEnv({ WRITEBACK_BUCKET: bucket, WRITEBACK_LOCAL_DIR: localDir });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

try {
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  console.log('🔐 開いたブラウザでLステップにログインしてください（画像認証を解く）。最大10分待機します…');
  await page.waitForSelector('input[type="password"]', { state: 'detached', timeout: 600000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('✅ ログインを検知しました。');

  // ログイン直後の既定アカウントが目的と違うことがある（勉強会 など）→ 目的のアカウントに切り替えてから保存
  await ensureAccount(page, accountName, console.log);
  console.log('   操作アカウント: ' + (await readHeaderText(page)).replace(/.*person /, ''));

  await saveSession(storage, await context.storageState());
  console.log(`💾 保存完了: ${storage.describe()}/session/storageState.json`);
  console.log('   翌日22時の自動実行からこのセッションで動きます。すぐ確認したい場合は Lambda を手動実行してください。');
} catch (e) {
  console.error('❌ 失敗: ' + e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
