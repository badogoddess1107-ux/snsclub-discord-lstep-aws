// Lambda ハンドラをローカルで実行する（デプロイ前の動作確認用）。
//
//   WRITEBACK_MAP_URL=<ApiBaseUrl>/writeback?token=<WritebackToken> \
//   WRITEBACK_LOCAL_DIR=./.local-storage \
//   npm run run:local                # 既定は DRY RUN（インポートしない）
//
//   npm run run:local -- --import    # 本番反映まで行う（十分に確認してから）
//
// セッションは先に  npm run session:login -- --local ./.local-storage  で作っておく。
// S3 を使いたい場合は WRITEBACK_LOCAL_DIR の代わりに WRITEBACK_BUCKET を指定する。
import { handler } from '../src/handler.js';

if (!process.env.WRITEBACK_MAP_URL) {
  console.error('❌ WRITEBACK_MAP_URL が未設定です（<ApiBaseUrl>/writeback?token=...）');
  process.exit(1);
}
process.env.LSTEP_ACCOUNT_NAME ||= 'SnsClub運営'; // template.yaml の既定値と揃える
const doImport = process.argv.includes('--import');
const res = await handler({ dryRun: !doImport });
const body = JSON.parse(res.body);
console.log('\n===== 結果 =====');
console.log(JSON.stringify({ status: body.data.status, stats: body.data.stats, error: body.error }, null, 2));
process.exitCode = res.statusCode === 200 ? 0 : 1;
