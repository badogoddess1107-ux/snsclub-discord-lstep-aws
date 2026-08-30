# aws-discord-lstep

SnsClub Discord × Lステップ 連携の**お客様向けフロー**を、GAS から **AWSサーバーレス**へ移行したもの。
低レイテンシ・自動スケール・管理最小化が目的。

> **書き戻し（DiscordID→Lステップ）は移行対象外**。従来の `lstep-discord-writeback/`
> （launchd 22時・Playwright）をそのまま維持し、データ取得先URLだけ本AWSに差し替える。

## 構成（サーバーレス）
```
お客様URLタップ
   │
   ▼
API Gateway (HTTP API, 固定の公開HTTPS URL)
   │
   ▼
Lambda (Node.js 20)
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
3. **書き戻しの `.env`** の `WRITEBACK_MAP_URL` を 新しい `/writeback` に変更
4. 動作確認後、GAS側は停止（トリガー削除・デプロイ無効化）

## 実装状況
- [x] 設計・IaC（README / template.yaml）
- [x] exec（uid/step→OAuth→入室→DynamoDB保存→即マッチ非同期起動→完了画面）
- [x] match（STEP0再利用・管理ID/ふりがな/フルネーム・Discord名照合・改名・タグ・曖昧/未マッチ通知）
- [x] writeback API（?token= でCSV返却）
- [x] Lステップ友だちキャッシュ（S3・TTL10分）
- [x] 純粋関数テスト（normalizeName / cleanIdentifier）
- [ ] （御社作業）AWSデプロイ・cutover・動作検証

## ファイル構成
```
src/lib/     config, discord, lstep, cache(S3), matching, names(純粋), dynamo, alert, html
src/handlers exec, match, writeback
template.yaml  SAM（API Gateway + Lambda×3 + DynamoDB + S3）
```
