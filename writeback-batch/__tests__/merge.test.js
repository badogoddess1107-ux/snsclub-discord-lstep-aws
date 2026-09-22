// node --test __tests__/merge.test.js
import test from 'node:test';
import assert from 'node:assert';
import iconv from 'iconv-lite';
import { toMap, parseLine, serializeLine, detectColumns, mergeCsvText, mergeCsvBuffer } from '../src/merge.js';

// Lステップ export の形: 1行目メタ, 2行目見出し, 3行目〜データ。各フィールドは "" 囲み
const META = '"友だち情報エクスポート","2026/09/22"';
const HEADER = '"ID","表示名","DiscordID"';
function csv(...rows) {
  return [META, HEADER, ...rows].join('\n');
}

test('toMap: CSV形式（ヘッダー有無どちらでも）', () => {
  assert.deepStrictEqual(toMap('lstep_manage_id,discord_user_id\n258515341,111\n999,222'), { 258515341: '111', 999: '222' });
  assert.deepStrictEqual(toMap('ID,DiscordID\n1,10'), { 1: '10' });
  assert.deepStrictEqual(toMap('1,10\n2,20'), { 1: '10', 2: '20' });
});

test('toMap: JSON形式（オブジェクト / 配列）', () => {
  assert.deepStrictEqual(toMap('{"1":"10"}'), { 1: '10' });
  assert.deepStrictEqual(toMap('[{"id":1,"discord_id":"10"}]'), { 1: '10' });
  assert.deepStrictEqual(toMap(''), {});
});

test('parseLine / serializeLine: "" 囲みと "" エスケープを往復できる', () => {
  const line = '"258515341","ひで""あき",""';
  const fields = parseLine(line);
  assert.deepStrictEqual(fields, ['258515341', 'ひで"あき', '']);
  assert.strictEqual(serializeLine(fields), line);
});

test('detectColumns: 列名で位置を検出する（位置に依存しない）', () => {
  assert.deepStrictEqual(detectColumns('"ID","表示名","DiscordID"'), { idCol: 1, discordCol: 3, columnCount: 3 });
  assert.deepStrictEqual(detectColumns('"DiscordID","ID"'), { idCol: 2, discordCol: 1, columnCount: 2 });
  assert.strictEqual(detectColumns('"ID","表示名"'), null, 'DiscordID列が無ければ null');
});

test('mergeCsvText: 空欄だけ埋め、既存値は保持、対象外は原文のまま', () => {
  const input = csv(
    '"258515341","ひであき",""',        // 空欄 → 埋める
    '"100","既存","999"',                // 既存値 → 保持
    '"200","対象外",""',                 // マップに無い → 原文のまま
  );
  const { text, stats } = mergeCsvText(input, { 258515341: '111', 100: '000' });
  const lines = text.split('\n');
  assert.strictEqual(lines[0], META, 'メタ行は不変');
  assert.strictEqual(lines[1], HEADER, '見出し行は不変');
  assert.strictEqual(lines[2], '"258515341","ひであき","111"');
  assert.strictEqual(lines[3], '"100","既存","999"', '既存のDiscordIDは上書きしない');
  assert.strictEqual(lines[4], '"200","対象外",""');
  assert.strictEqual(stats.filled, 1);
  assert.strictEqual(stats.kept, 1);
  assert.strictEqual(stats.notInMap, 1);
  assert.strictEqual(stats.lineCount, 5, '行数は入力と同じ');
});

test('mergeCsvText: DiscordID列が無ければエラー（項目選択漏れ）', () => {
  const input = [META, '"ID","表示名"', '"1","x"'].join('\n');
  assert.throws(() => mergeCsvText(input, { 1: '10' }), /DiscordID/);
});

test('mergeCsvText: CRLF入力でも壊れない・空行は保持', () => {
  const input = [META, HEADER, '"1","a",""', ''].join('\r\n');
  const { text } = mergeCsvText(input, { 1: '10' });
  assert.strictEqual(text.split('\n')[2], '"1","a","10"');
});

test('mergeCsvBuffer: Shift-JIS(CP932) のまま入出力できる', () => {
  const input = csv('"1","田畑　秀晃",""');
  const sjis = iconv.encode(input, 'cp932');
  const { buffer, stats } = mergeCsvBuffer(sjis, { 1: '12345' });
  const back = iconv.decode(buffer, 'cp932');
  assert.strictEqual(back.split('\n')[2], '"1","田畑　秀晃","12345"', '日本語が化けない');
  assert.strictEqual(stats.filled, 1);
  // UTF-8 として読むと化ける＝本当にShift-JISで出ている
  assert.notStrictEqual(buffer.toString('utf8'), back);
});
