// node --test __tests__/storage.test.js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LocalStorage, S3Storage, storageFromEnv, makeRunId, runPrefix,
  loadSession, saveSession, SESSION_KEY,
} from '../src/storage.js';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wb-storage-'));
}

test('makeRunId: JST の日時で "YYYY-MM-DD_HHmm"', () => {
  // 2026-09-22 13:00 UTC = 22:00 JST
  assert.strictEqual(makeRunId(new Date('2026-09-22T13:00:00Z')), '2026-09-22_2200');
  // 日付またぎ: 2026-09-22 15:30 UTC = 翌 00:30 JST
  assert.strictEqual(makeRunId(new Date('2026-09-22T15:30:00Z')), '2026-09-23_0030');
});

test('runPrefix', () => {
  assert.strictEqual(runPrefix('2026-09-22_2200'), 'runs/2026-09-22_2200/');
});

test('LocalStorage: put/get、未存在は null', async () => {
  const s = new LocalStorage(tmp());
  assert.strictEqual(await s.get('nope'), null);
  await s.put('runs/x/a.txt', Buffer.from('hello'));
  assert.strictEqual((await s.get('runs/x/a.txt')).toString(), 'hello');
});

test('セッションの保存と読込（壊れたJSONは null）', async () => {
  const s = new LocalStorage(tmp());
  assert.strictEqual(await loadSession(s), null);
  await saveSession(s, { cookies: [{ name: 'a' }], origins: [] });
  assert.deepStrictEqual(await loadSession(s), { cookies: [{ name: 'a' }], origins: [] });
  await s.put(SESSION_KEY, Buffer.from('{broken'));
  assert.strictEqual(await loadSession(s), null);
});

test('storageFromEnv: ローカル指定があればローカル、無ければS3、バケット未設定はエラー', () => {
  const dir = tmp();
  assert.ok(storageFromEnv({ WRITEBACK_LOCAL_DIR: dir }) instanceof LocalStorage);
  assert.ok(storageFromEnv({ WRITEBACK_BUCKET: 'b' }) instanceof S3Storage);
  assert.throws(() => storageFromEnv({}), /WRITEBACK_BUCKET/);
});

test('S3Storage: NoSuchKey は null、それ以外のエラーは投げる', async () => {
  const fakeClient = (err) => ({ send: async () => { throw err; } });
  const notFound = Object.assign(new Error('x'), { name: 'NoSuchKey' });
  assert.strictEqual(await new S3Storage('b', fakeClient(notFound)).get('k'), null);
  const denied = Object.assign(new Error('denied'), { name: 'AccessDenied' });
  await assert.rejects(() => new S3Storage('b', fakeClient(denied)).get('k'), /denied/);
});
