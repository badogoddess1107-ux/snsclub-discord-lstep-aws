import { CONFIG } from './config.js';

/**
 * Discord API 呼び出し。proxyUrl 設定時は discord.com を Worker に置換（40333対策）。
 */
async function discordFetch(url, { method = 'GET', headers = {}, body, form } = {}) {
  const h = { 'User-Agent': 'DiscordBot (https://snsclub.jp, 1.0.0)', ...headers };
  let target = url;
  if (CONFIG.proxyUrl) {
    target = url.replace('https://discord.com', CONFIG.proxyUrl);
    h['X-Proxy-Secret'] = CONFIG.proxySecret;
  }
  let payload;
  if (form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(target, { method, headers: h, body: payload });
  const text = await res.text();
  return { status: res.status, text, json() { try { return JSON.parse(text); } catch { return null; } } };
}

export function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: CONFIG.clientId,
    redirect_uri: CONFIG.webAppUrl,
    response_type: 'code',
    scope: CONFIG.DISCORD_OAUTH_SCOPES,
    state,
    prompt: 'consent',
  });
  return `${CONFIG.DISCORD_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const res = await discordFetch(CONFIG.DISCORD_OAUTH_TOKEN_URL, {
    method: 'POST',
    form: {
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: CONFIG.webAppUrl,
    },
  });
  if (res.status >= 200 && res.status < 300) return { data: res.json(), error: null };
  return { data: null, error: `token HTTP ${res.status}: ${res.text.slice(0, 300)}` };
}

export async function fetchDiscordUser(accessToken) {
  const res = await discordFetch(`${CONFIG.DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status >= 200 && res.status < 300) return { data: res.json(), error: null };
  return { data: null, error: `users/@me HTTP ${res.status}` };
}

export async function getGuildMember(guildId, userId) {
  const res = await discordFetch(`${CONFIG.DISCORD_API_BASE}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${CONFIG.botToken}` },
  });
  if (res.status === 200) return { data: res.json() };
  return { data: null, status: res.status };
}

export async function joinGuild(guildId, userId, accessToken) {
  const check = await getGuildMember(guildId, userId);
  if (check.data) return { ok: true, alreadyJoined: true, statusCode: 200 };
  const res = await discordFetch(`${CONFIG.DISCORD_API_BASE}/guilds/${guildId}/members/${userId}`, {
    method: 'PUT', headers: { Authorization: `Bot ${CONFIG.botToken}` }, body: { access_token: accessToken },
  });
  if (res.status === 201) return { ok: true, alreadyJoined: false, statusCode: 201 };
  if (res.status === 204) return { ok: true, alreadyJoined: true, statusCode: 204 };
  return { ok: false, error: `guilds.join HTTP ${res.status}: ${res.text.slice(0, 300)}`, statusCode: res.status };
}

export async function setNickname(guildId, userId, nickname) {
  const nick = String(nickname || '').slice(0, 32);
  if (!nick) return { ok: false, error: 'ニックネームが空です' };
  const res = await discordFetch(`${CONFIG.DISCORD_API_BASE}/guilds/${guildId}/members/${userId}`, {
    method: 'PATCH', headers: { Authorization: `Bot ${CONFIG.botToken}` }, body: { nick },
  });
  if (res.status === 200) { const m = res.json(); return { ok: true, nick: (m && m.nick) || nick }; }
  return { ok: false, error: `setNickname HTTP ${res.status}: ${res.text.slice(0, 200)}` };
}

/** Discord Webhook 送信（アラート等）。proxy対応。 */
export async function postWebhook(webhookUrl, payload) {
  const res = await discordFetch(webhookUrl, { method: 'POST', body: payload });
  return { status: res.status, text: res.text };
}
