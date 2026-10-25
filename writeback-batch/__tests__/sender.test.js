import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractManageId, pickMemberId, toLines, sameText } from '../src/sender.js';
import { buildMessage } from '../src/notify.js';

test('extractManageId は友だちリストの行テキストから管理IDを取る', () => {
  assert.equal(extractManageId('やまだゆり 停止中 ... 管理ID： 649421762907 流入経路_英語： x'), '649421762907');
  assert.equal(extractManageId('管理ID:123456789012'), '123456789012');
  assert.equal(extractManageId('管理IDなし'), null);
});

test('pickMemberId は管理IDが一致する1行だけを選ぶ', () => {
  const rows = [
    { href: '/line/detail/111', text: 'やまだゆり 管理ID： 649421762907' },
    { href: '/line/detail/222', text: 'やまだゆり 管理ID： 999999999999' },
  ];
  assert.equal(pickMemberId(rows, '649421762907'), '111');
  assert.equal(pickMemberId(rows, '000000000000'), null);
});

test('pickMemberId は同じ管理IDが複数あれば送らない', () => {
  const rows = [
    { href: '/line/detail/111', text: '管理ID： 649421762907' },
    { href: '/line/detail/333', text: '管理ID： 649421762907' },
  ];
  assert.equal(pickMemberId(rows, '649421762907'), null);
});

test('toLines / sameText', () => {
  assert.deepEqual(toLines('a\r\nb\n\nc'), ['a', 'b', '', 'c']);
  assert.equal(sameText('山田さん\n日時：10/1', '山田さん 日時：10/1'), true);
  assert.equal(sameText('山田さん', '佐藤さん'), false);
});

test('送信ワーカーの通知文', () => {
  assert.match(buildMessage('sender_needs_login', { count: 2, mentionId: '9' }), /ログインセッションが切れて/);
  assert.match(buildMessage('sender_needs_login', { count: 2, mentionId: '9' }), /<@&9>/);
  assert.match(buildMessage('sender_error', { runId: 'r1', error: 'x', bucket: 'b' }), /b\/sender\/r1\//);
});
