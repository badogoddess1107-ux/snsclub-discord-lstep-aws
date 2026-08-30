import { CONFIG } from '../lib/config.js';
import { queryByStatus } from '../lib/dynamo.js';

/**
 * 書き戻しバッチ用データ提供：?token=... 認証で「管理ID,DiscordID」CSVを返す。
 * lstep-discord-writeback/ の merge-discord-id.js --map-url がこれを取得する。
 */
export async function handler(event) {
  const q = (event && event.queryStringParameters) || {};
  if (!CONFIG.writebackToken || q.token !== CONFIG.writebackToken) {
    return { statusCode: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'forbidden' };
  }
  const matched = await queryByStatus('マッチ');
  const seen = new Set();
  const lines = ['lstep_manage_id,discord_user_id'];
  for (const r of matched) {
    const mid = String(r.lstep_manage_id || '').trim();
    const did = String(r.discord_user_id || '').trim();
    if (!mid || !did || seen.has(did)) continue;
    seen.add(did);
    lines.push(`${mid},${did}`);
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: lines.join('\n'),
  };
}
