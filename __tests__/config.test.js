import { test } from 'node:test';
import assert from 'node:assert';
import { guildIdForStep, serverLabelForStep, serverNameForStep, CONFIG } from '../src/lib/config.js';

test('guildIdForStep: step=1/2/3 で正しいギルドIDを返す', () => {
  assert.strictEqual(guildIdForStep('1'), CONFIG.DISCORD_GUILD_ID_SNSCLUB);
  assert.strictEqual(guildIdForStep('2'), CONFIG.DISCORD_GUILD_ID_CLASSCHAT);
  assert.strictEqual(guildIdForStep('3'), CONFIG.DISCORD_GUILD_ID_CLASSCHAT3);
  assert.strictEqual(guildIdForStep(3), CONFIG.DISCORD_GUILD_ID_CLASSCHAT3); // 数値でも可
});

test('serverLabelForStep: step=3 はクラスチャットⅢ表記', () => {
  assert.strictEqual(serverLabelForStep('1'), 'SnsClubサーバー');
  assert.strictEqual(serverLabelForStep('2'), 'SnsClub クラスチャットⅡ');
  assert.strictEqual(serverLabelForStep('3'), 'SnsClub クラスチャットⅢ');
});

test('serverNameForStep: step=3 はクラスチャットⅢ', () => {
  assert.strictEqual(serverNameForStep('3'), 'SnsClubクラスチャットⅢ');
});
