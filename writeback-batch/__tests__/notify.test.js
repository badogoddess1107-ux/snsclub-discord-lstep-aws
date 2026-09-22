// node --test __tests__/notify.test.js
import test from 'node:test';
import assert from 'node:assert';
import { buildMessage, notifyDiscord } from '../src/notify.js';

test('buildMessage: 成功はメンション無し・件数入り', () => {
  const m = buildMessage('success', { runId: 'r1', filled: 3, kept: 5, mapCount: 10, mentionId: '' });
  assert.match(m, /✅/);
  assert.match(m, /新規に埋めた: 3件/);
  assert.ok(!m.includes('<@&'), '成功時はメンションしない');
  assert.ok(!m.includes('DRY RUN'));
});

test('buildMessage: DRY RUN 表記', () => {
  assert.match(buildMessage('success', { runId: 'r1', dryRun: true }), /DRY RUN/);
});

test('buildMessage: セッション切れは担当者メンション＋復旧コマンド', () => {
  const m = buildMessage('needs_login', { runId: 'r1', mentionId: '42' });
  assert.match(m, /<@&42>/);
  assert.match(m, /session:login/);
});

test('buildMessage: エラーはスクショの場所を案内', () => {
  const m = buildMessage('error', { runId: 'r1', error: 'boom', bucket: 'my-bucket', mentionId: '42' });
  assert.match(m, /boom/);
  assert.match(m, /my-bucket\/runs\/r1\//);
});

test('notifyDiscord: Webhook未設定なら送らない', async () => {
  const r = await notifyDiscord('success', {}, {});
  assert.deepStrictEqual(r, { skipped: true });
});
