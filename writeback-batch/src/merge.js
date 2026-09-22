// Lステップ export CSV(Shift-JIS) の DiscordID列を、ID照合で埋める（純粋関数）。
// lstep-discord-writeback/merge-discord-id.js の移植。
//
// 安全設計（重要・変更禁止）:
//   - 1行目/2行目（Lステップのメタ行・列見出し）は絶対に変更しない
//   - 変更するのは「IDが mapping に存在し、かつ DiscordID が空」の行だけ
//   - 既存の DiscordID 値は絶対に上書き/消去しない（＝取り込み事故を防ぐ）
//   - 変更しない行は元の行をそのまま出力（フォーマット完全保持）
//   - 入出力とも Shift-JIS(CP932)。iconv-lite で変換（システムiconv不要 → Lambdaで動く）
import iconv from 'iconv-lite';

const ENCODING = 'cp932';

/** マッピングテキスト（CSV "ID,DiscordID" または JSON）→ { id: discordId } */
export function toMap(text) {
  const t = String(text || '').trim();
  const map = {};
  if (!t) return map;
  if (t[0] === '{' || t[0] === '[') {
    const j = JSON.parse(t);
    if (Array.isArray(j)) {
      j.forEach((r) => { if (r.id != null) map[String(r.id)] = String(r.discord_id || r.discordId || ''); });
    } else {
      Object.keys(j).forEach((k) => { map[String(k)] = String(j[k]); });
    }
    return map;
  }
  t.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    const cells = line.split(',').map((s) => s.replace(/^"|"$/g, '').trim());
    const id = cells[0], did = cells[1];
    if (!id || /^id$/i.test(id) || id === 'lstep_manage_id') return; // ヘッダー行スキップ
    if (did) map[id] = did;
  });
  return map;
}

/** Lステップ形式（各フィールドを "" で囲む）の1行を配列に */
export function parseLine(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '"') break;
    i++;
    let val = '';
    while (i < line.length) {
      if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; continue; }
      if (line[i] === '"') { i++; break; }
      val += line[i++];
    }
    fields.push(val);
    if (line[i] === ',') i++;
  }
  return fields;
}

export function serializeLine(fields) {
  return fields.map((f) => '"' + String(f).replace(/"/g, '""') + '"').join(',');
}

/**
 * 見出し行（2行目）から ID / DiscordID の列位置（1始まり）を検出する。
 * DiscordID 列が無い場合は null を返す（エクスポート時の項目選択漏れ）。
 */
export function detectColumns(headerLine) {
  const header = parseLine(headerLine || '');
  const idIdx = header.indexOf('ID');
  const didIdx = header.indexOf('DiscordID');
  if (didIdx < 0) return null;
  return { idCol: (idIdx >= 0 ? idIdx : 0) + 1, discordCol: didIdx + 1, columnCount: header.length };
}

/**
 * UTF-8 文字列のCSVに対してマージを行う。
 * 戻り値: { text, stats: { mapCount, filled, kept, notInMap, lineCount } }
 * DiscordID列が無い場合は throw。
 */
export function mergeCsvText(utf8Text, map) {
  const lines = utf8Text.split(/\r?\n/);
  const cols = detectColumns(lines[1]);
  if (!cols) {
    throw new Error('エクスポートCSVに "DiscordID" 列がありません。Lステップのエクスポート時に「友だち情報＝DiscordID」を選択してください。');
  }
  const { idCol, discordCol } = cols;
  let filled = 0, kept = 0, notInMap = 0;
  const out = lines.map((line, idx) => {
    if (idx < 2) return line;            // メタ行・見出し行は不変
    if (line.trim() === '') return line;
    const f = parseLine(line);
    if (f.length < Math.max(idCol, discordCol)) return line;
    const id = f[idCol - 1];
    const cur = f[discordCol - 1];
    if (!(id in map)) { notInMap++; return line; }
    if (cur && cur.trim() !== '') { kept++; return line; } // 既存値は保持
    f[discordCol - 1] = map[id];
    filled++;
    return serializeLine(f);
  });
  return {
    text: out.join('\n'),
    stats: { mapCount: Object.keys(map).length, filled, kept, notInMap, lineCount: lines.length, ...cols },
  };
}

/** Shift-JIS の Buffer を受け取り、マージ済み Shift-JIS の Buffer を返す（Lambda で使う入口） */
export function mergeCsvBuffer(sjisBuffer, map) {
  const utf8 = iconv.decode(sjisBuffer, ENCODING);
  const { text, stats } = mergeCsvText(utf8, map);
  return { buffer: iconv.encode(text, ENCODING), stats };
}
