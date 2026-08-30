import { CONFIG } from './config.js';
import { getFriendCache, putFriendCache } from './cache.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function normalizeFriend(f) {
  return {
    uid: f.uid || f.friend_id || f.line_user_id || '',
    manage_id: String(f.id || f.manage_id || ''),
    line_name: f.name || f.line_name || f.line_display_name || '',
    real_name: f.full_name || f.real_name || '',
    display_name: f.system_name || f.display_name || f.system_display_name || '',
    is_blocked: f.is_blocked || false,
  };
}

/** /friends/{値} で1件直接取得（管理ID・UIDどちらでも、APIが受け付ければ取得） */
export async function fetchFriendDirect(idOrUid) {
  try {
    const res = await fetch(`${CONFIG.LSTEP_API_BASE_URL}/friends/${encodeURIComponent(idOrUid)}`, {
      headers: { Authorization: `Bearer ${CONFIG.lstepApiToken}`, Accept: 'application/json' },
    });
    if (res.status !== 200) return null;
    const data = await res.json();
    const raw = data.data || data.friend || data;
    const f = normalizeFriend(raw);
    return f.uid ? f : null;
  } catch {
    return null;
  }
}

async function fetchAllFriends() {
  let all = [];
  let cursor = null;
  let complete = false;
  for (let page = 0; page < 50; page++) {
    let url = `${CONFIG.LSTEP_API_BASE_URL}/friends?limit=1000`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${CONFIG.lstepApiToken}`, Accept: 'application/json' } });
    } catch { break; }
    if (res.status !== 200) break;
    const data = await res.json();
    const friends = data.data || data.friends || data.items || data || [];
    if (!Array.isArray(friends)) break;
    friends.forEach((f) => all.push(normalizeFriend(f)));
    cursor = data.next_cursor || data.cursor || (data.paging && data.paging.next) || null;
    const perPage = data.per_page || friends.length;
    if (!cursor || friends.length < perPage) { complete = true; break; }
    await sleep(150);
  }
  return { friends: all, complete };
}

/** キャッシュ優先で友だち一覧を取得（完全取得できた時だけキャッシュ） */
export async function getCachedFriends() {
  const cached = await getFriendCache();
  if (cached && cached.length) return cached;
  const res = await fetchAllFriends();
  if (res.complete && res.friends.length) await putFriendCache(res.friends);
  return res.friends;
}

/** Lステップ カスタムAPI（Webhook）でタグ付与。api.lineml.jp なのでproxy不要。 */
export async function notifyLstepWebhook(uid, step) {
  const url = String(step) === CONFIG.STEP_SNSCLUB ? CONFIG.webhookSnsclub : CONFIG.webhookClasschat;
  if (!url) return { ok: false, error: 'Webhook URL未設定' };
  const payload = { uid, params: { friend_id: uid } };
  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CONFIG.lstepApiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status >= 200 && res.status < 300) return { ok: true, statusCode: res.status };
      lastErr = `HTTP ${res.status}`;
      if ((res.status >= 500 || res.status === 429) && attempt < 3) { await sleep(2 ** attempt * 1000); continue; }
      return { ok: false, error: lastErr, statusCode: res.status };
    } catch (e) {
      lastErr = e.message;
      if (attempt < 3) { await sleep(2 ** attempt * 1000); continue; }
      return { ok: false, error: lastErr };
    }
  }
  return { ok: false, error: `リトライ後失敗: ${lastErr}` };
}
