import { getCachedFriends, fetchFriendDirect } from './lstep.js';
import { normalizeName, cleanIdentifier } from './names.js';
export { normalizeName, cleanIdentifier };

function looksLikeUid(v) { return /^U[0-9a-f]{32}$/i.test(String(v || '')); }

function result(f, confidence) {
  return {
    found: true, uid: f.uid, manage_id: f.manage_id || '',
    line_name: f.line_name, real_name: f.real_name, display_name: f.display_name,
    confidence, candidates: 1,
  };
}

export async function findByUid(uid) {
  const direct = await fetchFriendDirect(uid);
  if (direct && direct.uid) return result(direct, '高（UID直接）');
  const friends = await getCachedFriends();
  for (const f of friends) if (String(f.uid) === String(uid)) return result(f, '高（UID一覧一致）');
  return { found: false, uid: null, confidence: 'UID該当なし', candidates: 0 };
}

export async function findByValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return { found: false, uid: null, confidence: '対象値なし', candidates: 0 };
  const direct = await fetchFriendDirect(raw);
  if (direct && direct.uid) return result(direct, '高（直接取得）');
  const friends = await getCachedFriends();
  if (!friends.length) return { found: false, uid: null, confidence: 'Lステップ取得失敗', candidates: 0 };

  if (/^[0-9]+$/.test(raw)) {
    const byId = friends.filter((f) => f.is_blocked !== true && f.manage_id && f.manage_id === raw);
    if (byId.length === 1) return result(byId[0], '高（管理ID一致）');
    if (byId.length > 1) return { found: false, uid: null, confidence: `管理ID重複(${byId.length}件)`, candidates: byId.length };
  }

  const target = normalizeName(raw);
  const byName = friends.filter((f) =>
    f.is_blocked !== true &&
    [normalizeName(f.display_name), normalizeName(f.real_name), normalizeName(f.line_name)].filter(Boolean).includes(target));
  if (byName.length === 1) return result(byName[0], '高（名前一意）');
  if (byName.length > 1) return { found: false, uid: null, confidence: `曖昧（${byName.length}件同名）`, candidates: byName.length };
  return { found: false, uid: null, confidence: '未マッチ', candidates: 0 };
}

/** "|" 区切りの識別子を先頭から順に照合（管理ID→ふりがな→フルネーム等） */
export async function findByAnyIdentifier(rawValue) {
  const parts = String(rawValue || '').split('|').map(cleanIdentifier).filter((s) => s !== '');
  if (!parts.length) return { found: false, uid: null, confidence: '有効な識別子なし', candidates: 0 };
  let lastAmbiguous = null;
  for (const v of parts) {
    const r = looksLikeUid(v) ? await findByUid(v) : await findByValue(v);
    if (r.found) return r;
    if (r.candidates > 1) lastAmbiguous = r;
  }
  return lastAmbiguous || { found: false, uid: null, confidence: '未マッチ', candidates: 0 };
}

/** Discord名（ユーザー名・表示名）で照合（最終フォールバック） */
export async function findByDiscordName(username, displayName) {
  const targets = [];
  const n1 = normalizeName(username), n2 = normalizeName(displayName);
  if (n1) targets.push(n1);
  if (n2 && n2 !== n1) targets.push(n2);
  if (!targets.length) return { found: false, uid: null, confidence: '対象名不明', candidates: 0 };
  const friends = await getCachedFriends();
  if (!friends.length) return { found: false, uid: null, confidence: 'Lステップ取得失敗', candidates: 0 };
  const matches = friends.filter((f) => {
    if (f.is_blocked === true) return false;
    const cands = [normalizeName(f.display_name), normalizeName(f.real_name), normalizeName(f.line_name)].filter(Boolean);
    return targets.some((t) => cands.includes(t));
  });
  if (matches.length === 1) return result(matches[0], '高（名前一意）');
  if (matches.length > 1) return { found: false, uid: null, confidence: `曖昧（${matches.length}件が同名）`, candidates: matches.length };
  return { found: false, uid: null, confidence: '未マッチ', candidates: 0 };
}
