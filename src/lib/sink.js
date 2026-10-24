import { CONFIG } from './config.js';

/**
 * 受信専用GAS Web AppへPOST（タイムアウト付き）。失敗しても本処理に影響させない。
 * @param {object} body token以外の本体（{record} または {mode, record}）
 * @param {number} timeoutMs タイムアウト（お客様を待たせる /exec では短めに）
 */
async function postSink(body, timeoutMs = 8000) {
  if (!CONFIG.sheetSinkUrl || !CONFIG.sheetSinkToken) return { ok: false, skipped: true };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(CONFIG.sheetSinkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: CONFIG.sheetSinkToken, ...body }),
      redirect: 'follow', // GAS Web Appは302→googleusercontent.comへ飛ぶため追従必須
      signal: ctrl.signal,
    });
    if (res.status >= 200 && res.status < 400) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

/** マッチ結果1件を「マッピング管理」タブへUpsert（mode無し＝従来動作） */
export async function pushToSheet(record) {
  return postSink({ record });
}

/**
 * URLタップを「タップ追跡」タブへ記録。nonceをキーに、後で入室済みへ更新する。
 * ※ /exec（お客様が待つ）から呼ぶため短いタイムアウト。失敗しても入室はブロックしない。
 */
export async function logTap(record) {
  return postSink({ mode: 'tap', record }, 2000);
}

/** タップ行を「入室済み」に更新（nonceで紐付け） */
export async function markTapJoined(record) {
  return postSink({ mode: 'tap_joined', record }, 2000);
}
