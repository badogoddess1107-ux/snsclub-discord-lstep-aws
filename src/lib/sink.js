import { CONFIG } from './config.js';

/**
 * マッチ結果1件を旧GASスプシへ即時プッシュ（受信専用GAS Web AppへPOST）。
 * お客様フローとは独立した読み取り用ミラー。失敗しても本処理に影響させない。
 * @param {object} record 列名→値（lstep_uid, lstep_manage_id, ... match_status 等）
 * @returns {Promise<{ok:boolean, skipped?:boolean, error?:string}>}
 */
export async function pushToSheet(record) {
  if (!CONFIG.sheetSinkUrl || !CONFIG.sheetSinkToken) return { ok: false, skipped: true };
  try {
    const res = await fetch(CONFIG.sheetSinkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: CONFIG.sheetSinkToken, record }),
      redirect: 'follow', // GAS Web Appは302→googleusercontent.comへ飛ぶため追従必須
    });
    if (res.status >= 200 && res.status < 400) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
