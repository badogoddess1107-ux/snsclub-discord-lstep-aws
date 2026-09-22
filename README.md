# aws-discord-lstep

SnsClub Discord × Lステップ 連携の**お客様向けフロー**を、GAS から **AWSサーバーレス**へ移行したもの。
低レイテンシ・自動スケール・管理最小化が目的。

> **書き戻し（DiscordID→Lステップ）も本スタックに統合済み**（`writeback-batch/`、毎日22時JST・Lambda）。
> 従来の `lstep-discord-writeback/`（Mac・launchd）は不要になる。詳細は「書き戻しバッチ」の節を参照。

## 構成（サーバーレス）
```
お客様URLタップ
   │
   ▼
API Gateway (HTTP API, 固定の公開HTTPS URL)
   │
   ▼
Lambda (Node.js 22)
   ├ exec        : uid/step受信 → Discord OAuthへリダイレクト
   ├ callback    : code受領 → token交換 → guilds.join(入室) → DynamoDB保存
   │               → 「即マッチ」を非同期起動 → 完了画面を即返す
   ├ match       : 本人特定 → 改名 → タグ付与(次配信) / 曖昧・未マッチ通知
   └ writebackApi: [管理ID,DiscordID] のCSVを返す（書き戻しバッチが取得）
   │
   ▼
DynamoDB Mapping : discord_user_id + step をキーに連携状態を保存（スプシの代替）
S3 FriendCache   : Lステップ友だち一覧(〜1MB超)をキャッシュ（毎回6000件取得の遅さを解消）
```

## GASからの主な改善（レイテンシ）
| 項目 | GAS（旧） | AWS（新） |
|---|---|---|
| Web応答 | コールドスタートで遅い | Lambda（必要ならProvisioned Concurrency）|
| マッチ実行 | 1分ごとポーリング（最大1分遅延）| 入室直後に即実行（イベント駆動）|
| データ保存 | スプレッドシート（遅い）| DynamoDB（数ms）|
| 友だち取得 | 毎回6000件フェッチ（~65秒）| キャッシュ（TTL付き）|

## DynamoDB スキーマ（案）
**テーブル `Mapping`**
- PK: `discord_user_id` (S) / SK: `step` (S)
- 属性: lstep_uid, lstep_manage_id, lstep_line_name, lstep_real_name, lstep_display_name,
  discord_username, discord_display_name, discord_server, match_status, match_confidence,
  created_at, updated_at
- GSI1: `match_status` で「マッチ済み」抽出（書き戻しAPI用）

**テーブル `LstepFriendCache`**
- PK: `key`（例 "all"） / 属性: friends(JSON), fetched_at / TTL

## 環境変数（Lambda / SSM Parameter Store 推奨）
- DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_BOT_TOKEN
- LSTEP_API_TOKEN / LSTEP_WEBHOOK_URL_SNSCLUB / LSTEP_WEBHOOK_URL_CLASSCHAT
- DISCORD_ALERT_WEBHOOK_URL / DISCORD_ALERT_THREAD_ID / DISCORD_ALERT_MENTION_ID
- WRITEBACK_TOKEN（書き戻しAPIの認証）
- （任意）DISCORD_PROXY_URL / DISCORD_PROXY_SECRET … 40333対策。AWS IPで直接叩けるなら不要

## デプロイ（御社のAWS認証情報で実行）
```bash
cd aws-discord-lstep
npm install
sam build
# 初回（機密はここで注入。値は現GAS/Lステップ/Discordのものを流用）
sam deploy --guided \
  --parameter-overrides \
    DiscordClientId=... DiscordClientSecret=... DiscordBotToken=... \
    LstepApiToken=... LstepWebhookSnsclub=... LstepWebhookClasschat=... \
    DiscordAlertWebhookUrl=... WritebackToken=... \
    WebAppUrl=https://xxxx.execute-api.ap-northeast-1.amazonaws.com/prod/exec
```
→ 出力 `ApiBaseUrl` が新しい公開エンドポイント。
> 初回は WebAppUrl が未確定なので、①一度デプロイ→②出力URLを WebAppUrl=<出力>/exec にして再デプロイ、が確実。
> 機密は SecureString(SSM) 参照に置き換えるとより安全（任意）。

## 移行時に必要な切り替え（cutover）
1. **Discord Developer Portal** のリダイレクトURIを、新しい API Gateway の `/callback` に変更
2. **Lステップ配信URL** を、GASの `/exec` から 新しい API Gateway の `/exec` に変更
3. 書き戻しは本スタックの `writeback-batch/` に統合済み（「書き戻しバッチ」の節の cutover 手順で Mac 側を停止）
4. 動作確認後、GAS側は停止（トリガー削除・デプロイ無効化）

## 実装状況
- [x] 設計・IaC（README / template.yaml）
- [x] exec（uid/step→OAuth→入室→DynamoDB保存→即マッチ非同期起動→完了画面）
- [x] match（STEP0再利用・管理ID/ふりがな/フルネーム・Discord名照合・改名・タグ・曖昧/未マッチ通知）
- [x] writeback API（?token= でCSV返却）
- [x] Lステップ友だちキャッシュ（S3・TTL10分）
- [x] 純粋関数テスト（normalizeName / cleanIdentifier）
- [x] 書き戻しバッチ（writeback-batch: Lambda + Scheduler + S3。実Lステップで DRY RUN 通し検証済み）
- [ ] （御社作業）AWSデプロイ・cutover・動作検証

## ファイル構成
```
src/lib/     config, discord, lstep, cache(S3), matching, names(純粋), dynamo, alert, html
src/handlers exec, match, writeback
writeback-batch/  書き戻しバッチ（下記）。依存が大きいため CodeUri を分離
template.yaml  SAM（API Gateway + Lambda×4 + DynamoDB + S3×2 + Scheduler）
```

---

## 書き戻しバッチ（DiscordID→Lステップ）— `writeback-batch/`

Mac の launchd で動かしていた `lstep-discord-writeback/` を Lambda 化したもの。
**田畑のPCが無くても毎日22時(JST)に自動で動く。**

### 仕組み
```
EventBridge Scheduler (22:00 JST)
   │
   ▼
Lambda WritebackBatchFunction (x86_64 / 2GB / 最大15分)
   ├ S3 session/storageState.json からログインセッションを復元
   ├ ヘッドレスChromium(@sparticuz/chromium + playwright-core) で Lステップ管理画面を操作
   │    友だちリスト → CSVエクスポート(DiscordID列) → 生成待ち → ダウンロード
   ├ 自スタックの /writeback?token= から「管理ID,DiscordID」を取得し、空欄だけ埋める
   ├ CSVインポート → 「このデータを反映する」
   ├ 成果物を S3 runs/<実行ID>/ に保存（export.csv / merged.csv / スクショ / summary.json）
   └ Discord のアラートスレッドに結果を通知
```
- **人が関与するのはログイン（画像認証）だけ。** Lステップの CAPTCHA は自動化しない（できない）。
- ログインユーザーは複数アカウント（SnsClub運営 / 勉強会 など）を持ち、ログイン直後の既定が目的と違うことがある。
  そのため毎回ヘッダーを確認し、違えば「**SnsClub運営に切り替え**」を自動で押す（`LstepAccountName` パラメータ）。
- セッションが切れると Lambda は `needs_login` で終了し、Discord に担当者メンション付きで通知する。
  担当者が下記「セッション更新」を行えば翌日から自動再開する。
- 安全設計は旧実装と同じ: **空欄の DiscordID だけ埋める／既存値は絶対に上書きしない／メタ行・見出し行は不変**。
  加えて、埋める行が0件ならインポート自体をスキップする（無意味な全件更新を避ける）。
- Scheduler のリトライは 0 回（二重インポート防止）。失敗は翌日に再実行される。

### デプロイ（担当者）
既存の `sam build && sam deploy` に含まれる。追加で必要なものは無い（パラメータは既定値で可）。
```bash
cd aws-discord-lstep
sam build && sam deploy
```
出力に以下が増える:
- `WritebackBucketName` … セッション・成果物のバケット（次の「セッション更新」で使う）
- `WritebackBatchFunctionName` … 手動実行に使う Lambda 名

> 初回検証は DRY RUN 推奨: `sam deploy --parameter-overrides WritebackDryRun=1 ...` でデプロイすると、
> インポートせず merged.csv を作るところまでで止まる。S3 の `runs/<実行ID>/merged.csv` を確認して
> 問題なければ `WritebackDryRun=0` で再デプロイ。

### セッション更新（初回・セッション切れ時。担当者の手元PCで）
Lステップにログインしたブラウザのセッションを S3 に保存する。パスワードはブラウザで人が打つだけで、
スクリプトもS3も扱わない。
```bash
cd aws-discord-lstep/writeback-batch
npm install
npx playwright install chromium        # 初回のみ
npm run session:login -- --bucket <WritebackBucketName>
```
→ ブラウザが開くので Lステップにログイン（画像認証を解く）→ 自動で保存されて終了。
AWS 認証情報（`aws configure` 済み or 環境変数）が必要。

### 手動実行・確認
```bash
# すぐ動かして確認（DRY RUN。インポートしない）
aws lambda invoke --function-name <WritebackBatchFunctionName> \
  --cli-binary-format raw-in-base64-out --payload '{"dryRun":true}' out.json && cat out.json

# 本番反映まで
aws lambda invoke --function-name <WritebackBatchFunctionName> --payload '{}' out.json
```
- 直近の結果: S3 `runs/latest.json`。各実行の詳細: `runs/<実行ID>/summary.json`
- 失敗時のスクショ: `runs/<実行ID>/*.png`（ログは CloudWatch Logs にも出る）

### ローカルで動作確認（デプロイ前）
```bash
cd aws-discord-lstep/writeback-batch
npm install && npx playwright install chromium
npm run session:login -- --local ./.local-storage          # ブラウザでログイン
WRITEBACK_LOCAL_DIR=./.local-storage \
WRITEBACK_MAP_URL='<ApiBaseUrl>/writeback?token=<WritebackToken>' \
npm run run:local                                           # DRY RUN（--import で本番反映）
```

### 切り替え（cutover）
1. デプロイ → セッション更新 → DRY RUN で `merged.csv` を確認
2. `WritebackDryRun=0` で再デプロイ（または既定のまま）
3. **Mac 側の launchd を停止**（二重実行防止）:
   `launchctl bootout gui/$(id -u)/com.snsclub.discord-writeback && rm ~/Library/LaunchAgents/com.snsclub.discord-writeback.plist`
4. 翌日22時以降、Discord のアラートスレッドに「✅ DiscordID書き戻し（AWS）完了」が届けば移行完了

### 制約・注意
- `@sparticuz/chromium`（143）と `playwright-core`（1.57）は **Chromium のメジャーバージョンを揃えて**ある。
  片方だけ上げると起動しなくなるので、更新時は両方を対応する組み合わせにする。
- Lambda は x86_64（`@sparticuz/chromium` が arm64 未対応のため）。他の関数は arm64 のまま。
- Lステップの画面構成が変わると操作が失敗する。その場合は `runs/<実行ID>/*.png` を見てセレクタを直す
  （`src/lstepFlow.js`。旧 `automate.js` と同じ手順・セレクタ）。
  実例: 2026/09 に「友だち情報名を入力」→「友だち情報欄名を入力」へ変わり旧実装が止まった（本実装は両方に対応済み）。
