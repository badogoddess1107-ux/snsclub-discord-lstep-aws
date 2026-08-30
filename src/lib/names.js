// 依存なしの純粋関数（名前の正規化・識別子クリーニング）。テスト容易化のため分離。
export function normalizeName(name) {
  if (!name) return '';
  return String(name)
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}
export function cleanIdentifier(v) {
  v = String(v || '');
  v = v.replace(/｛/g, '{').replace(/｝/g, '}');
  v = v.replace(/[{}【】〔〕\[\]［］（）]/g, '');
  v = v.replace(/^[\s　​‌‍﻿]+|[\s　​‌‍﻿]+$/g, '');
  if (v === '' || v === '-') return '';
  return v;
}
