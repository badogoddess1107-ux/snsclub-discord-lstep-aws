// node --test __tests__/lstepFlow.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isOnAccount, fetchMap } from '../src/lstepFlow.js';

test('isOnAccount: ヘッダーに目的アカウントが表示されていれば true', () => {
  const header = 'サポート expand_more 送信数 person 久保梨生 (副管理者) SnsClub運営 expand_more';
  assert.strictEqual(isOnAccount(header, 'SnsClub運営'), true);
});

test('isOnAccount: 別アカウント表示中は false', () => {
  const header = 'person 久保梨生 (運用者) SnsClub【勉強会参加者限定】 expand_more';
  assert.strictEqual(isOnAccount(header, 'SnsClub運営'), false);
});

test('isOnAccount: ドロップダウンの「〜に切り替え」項目だけでは true にしない', () => {
  // メニューを開くと他アカウントが「SnsClub運営に切り替え」として並ぶ。これは"表示中"ではない
  const header = 'person 久保梨生 (運用者) SnsClub【勉強会参加者限定】 expand_more マイページ SnsClub運営に切り替え ログアウト';
  assert.strictEqual(isOnAccount(header, 'SnsClub運営'), false);
});

test('isOnAccount: アカウント名未指定なら常に true（チェックしない）', () => {
  assert.strictEqual(isOnAccount('anything', ''), true);
});

test('fetchMap: file:// でローカルのマッピングを読める（検証用）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-'));
  const p = path.join(dir, 'map.csv');
  fs.writeFileSync(p, 'lstep_manage_id,discord_user_id\n1,10\n');
  assert.deepStrictEqual(await fetchMap('file://' + p), { 1: '10' });
});
