// 設定・定数（機密は環境変数から。SAMのParameters経由でLambda環境変数に注入）
export const CONFIG = {
  // 公開してよい定数
  DISCORD_GUILD_ID_SNSCLUB: '1151442122361282641',
  DISCORD_GUILD_ID_CLASSCHAT: '1475397327773499392',
  DISCORD_OAUTH_AUTHORIZE_URL: 'https://discord.com/api/oauth2/authorize',
  DISCORD_OAUTH_TOKEN_URL: 'https://discord.com/api/oauth2/token',
  DISCORD_API_BASE: 'https://discord.com/api/v10',
  DISCORD_OAUTH_SCOPES: 'identify guilds.join',
  LSTEP_API_BASE_URL: 'https://api.lineml.jp/v2/api',
  STEP_SNSCLUB: '1',
  STEP_CLASSCHAT: '2',

  // 機密・環境依存（環境変数）
  clientId: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  botToken: process.env.DISCORD_BOT_TOKEN,
  webAppUrl: process.env.WEB_APP_URL,            // = API Gateway の /exec URL（Discord redirect_uri と一致必須）
  lstepApiToken: process.env.LSTEP_API_TOKEN,
  webhookSnsclub: process.env.LSTEP_WEBHOOK_URL_SNSCLUB,
  webhookClasschat: process.env.LSTEP_WEBHOOK_URL_CLASSCHAT,
  alertWebhook: process.env.DISCORD_ALERT_WEBHOOK_URL,
  alertThreadId: process.env.DISCORD_ALERT_THREAD_ID,
  alertMentionId: process.env.DISCORD_ALERT_MENTION_ID,
  writebackToken: process.env.WRITEBACK_TOKEN,
  // 40333対策（Discord IPブロック）：AWSのIPで直接叩けるなら未設定でOK。ブロック時はWorker経由
  proxyUrl: process.env.DISCORD_PROXY_URL || '',
  proxySecret: process.env.DISCORD_PROXY_SECRET || '',
  // AWSリソース
  mappingTable: process.env.MAPPING_TABLE,
  friendCacheBucket: process.env.FRIEND_CACHE_BUCKET,
  matchFunctionName: process.env.MATCH_FUNCTION_NAME || '',
};

export function guildIdForStep(step) {
  return String(step) === CONFIG.STEP_SNSCLUB ? CONFIG.DISCORD_GUILD_ID_SNSCLUB : CONFIG.DISCORD_GUILD_ID_CLASSCHAT;
}
export function serverNameForStep(step) {
  return String(step) === CONFIG.STEP_SNSCLUB ? 'SnsClub運営/お知らせ' : 'SnsClubクラスチャットⅡ';
}
export function serverLabelForStep(step) {
  return String(step) === CONFIG.STEP_SNSCLUB ? 'SnsClubサーバー' : 'SnsClub クラスチャットⅡ';
}
