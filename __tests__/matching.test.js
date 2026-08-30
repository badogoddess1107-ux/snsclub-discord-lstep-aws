import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeName, cleanIdentifier } from '../src/lib/names.js';

test('normalizeName: 空白除去・全角半角統一・小文字化', () => {
  assert.strictEqual(normalizeName('西尾 佳代'), '西尾佳代');
  assert.strictEqual(normalizeName('Ｈideaki'), 'hideaki');
});
test('cleanIdentifier: カッコ除去・空マーカー', () => {
  assert.strictEqual(cleanIdentifier('{{542740857567}}'), '542740857567');
  assert.strictEqual(cleanIdentifier('【かわかみまちこ】'), 'かわかみまちこ');
  assert.strictEqual(cleanIdentifier('{{-}}'), '');
});
