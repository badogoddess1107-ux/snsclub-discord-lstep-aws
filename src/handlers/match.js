import { guildIdForStep } from '../lib/config.js';
import { getMapping, updateMappingFields, queryByDiscordId } from '../lib/dynamo.js';
import { findByAnyIdentifier, findByDiscordName, normalizeName } from '../lib/matching.js';
import { setNickname } from '../lib/discord.js';
import { notifyLstepWebhook } from '../lib/lstep.js';
import { notifyManualAlert } from '../lib/alert.js';

/**
 * 本人特定 → 改名 → タグ付与（次配信）/ 曖昧・未マッチ通知。
 * exec の callback から非同期(Event)で { discord_user_id, step } を受けて実行。
 */
export async function handler(event) {
  const discordUserId = String(event.discord_user_id);
  const step = String(event.step);
  const row = await getMapping(discordUserId, step);
  if (!row) { console.log('対象行なし', discordUserId, step); return; }

  // STEP0: 同じDiscord IDで過去に「マッチ」済みなら再利用（最優先・最も確実）
  let matchResult = null;
  const others = await queryByDiscordId(discordUserId);
  const prior = others.find((o) => o.match_status === 'マッチ' && /^U[0-9a-f]{32}$/i.test(String(o.lstep_uid || '')));
  if (prior) {
    matchResult = {
      found: true, uid: prior.lstep_uid, manage_id: prior.lstep_manage_id || '',
      line_name: prior.lstep_line_name, real_name: prior.lstep_real_name, display_name: prior.lstep_display_name,
      confidence: '高（既存の本人特定を再利用）', candidates: 1,
    };
  }

  // STEP1: 管理ID/ふりがな/フルネーム → Discord名 の順で照合
  if (!matchResult || !matchResult.found) {
    const identifiers = [row.lstep_manage_id, row.lstep_uid].filter((v) => String(v || '').length > 0).join('|');
    matchResult = await findByAnyIdentifier(identifiers);
    if (!matchResult || !matchResult.found) {
      const byD = await findByDiscordName(row.discord_username, row.discord_display_name);
      if (byD.found || !matchResult) matchResult = byD;
    }
  }

  const effectiveUid = matchResult.found ? matchResult.uid : row.lstep_uid;
  const systemName = matchResult.display_name || '';
  const bestName = matchResult.found
    ? (matchResult.display_name || matchResult.real_name || matchResult.line_name || '')
    : '';
  let newDiscordName = row.discord_display_name;
  let matchStatus, matchConfidence;

  if (!matchResult.found) {
    matchStatus = matchResult.candidates > 1 ? '曖昧' : '未マッチ';
    matchConfidence = matchResult.confidence;
  } else if (!bestName) {
    matchStatus = 'マッチ_名前なし';
    matchConfidence = matchResult.confidence + ' / 名前フィールドが全て空';
  } else {
    const guildId = guildIdForStep(step);
    const nick = await setNickname(guildId, discordUserId, bestName);
    if (nick.ok) { newDiscordName = nick.nick; matchStatus = 'マッチ'; matchConfidence = matchResult.confidence; }
    else { matchStatus = 'マッチ_改名失敗'; matchConfidence = String(nick.error).slice(0, 80); }
  }

  await updateMappingFields(discordUserId, step, {
    lstep_uid: effectiveUid,
    lstep_manage_id: matchResult.manage_id || row.lstep_manage_id || '',
    lstep_line_name: matchResult.line_name || '',
    lstep_real_name: matchResult.real_name || '',
    lstep_display_name: systemName,
    discord_display_name: newDiscordName,
    match_status: matchStatus,
    match_confidence: matchConfidence,
    updated_at: new Date().toISOString(),
  });

  const namesMatch = !!bestName && normalizeName(newDiscordName) === normalizeName(bestName);
  if (matchStatus === 'マッチ' && effectiveUid && namesMatch) {
    const wh = await notifyLstepWebhook(effectiveUid, step);
    if (wh.error) {
      console.error('Webhook送信失敗', wh.error);
      await updateMappingFields(discordUserId, step, {
        match_status: 'マッチ_通知失敗', match_confidence: String(wh.error).slice(0, 80),
      });
    }
  } else if (matchStatus === '曖昧' || matchStatus === '未マッチ') {
    await notifyManualAlert(
      { discord_user_id: discordUserId, discord_display_name: newDiscordName, uid: row.lstep_uid, step, created_at: row.created_at },
      matchStatus, matchResult,
    );
  }
  console.log(`match完了 ${discordUserId}/${step} → ${matchStatus} (${matchConfidence})`);
}
