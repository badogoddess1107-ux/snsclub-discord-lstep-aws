// Lステップ個別トークへのメッセージ送信（1on1講師マッチングの確定連絡・参加確認など）。
//
// 送る内容は GAS（1on1講師マッチング）の送信キューから取る（senderHandler.js）。
// ログインセッションは書き戻しバッチと共用（S3 の session/storageState.json）。
//
// 手順（2026-10-25 に管理画面を確認して決めた）:
//   1. 友だちリスト(/line/show) の「友だち名を検索」で生徒名を検索
//   2. 結果の行に出る「管理ID：<数字>」が一致する行の /line/detail/<内部ID> を取る（次回からはキャッシュ）
//   3. 個別トーク /line/visual?member=<内部ID> を開き、右側の友だち情報の管理IDが一致することを確認（誤送信防止）
//   4. 入力欄（tiptap / ProseMirror）に本文を入れる。Enter は改行、Shift+Enter が送信
//   5. 送信ボタン（material icon "send"）を押し、トーク欄に本文が出たことを確認
import { loadSession, saveSession } from './storage.js';
import { isLoginPage, ensureAccount } from './lstepFlow.js';

export const LSTEP_BASE = 'https://manager.linestep.net';
export const MEMBER_CACHE_KEY = 'sender/members.json';

/** テキスト中の「管理ID：123456789012」を取り出す（純粋関数） */
export function extractManageId(text) {
  const m = /管理ID\s*[：:]?\s*(\d{6,20})/.exec(String(text || ''));
  return m ? m[1] : null;
}

/** 友だちリストの検索結果行から、管理IDが一致する行の内部IDを返す（純粋関数） */
export function pickMemberId(rows, manageId) {
  const hits = rows.filter((r) => extractManageId(r.text) === String(manageId));
  if (hits.length !== 1) return null; // 0件・重複はどちらも送らない
  const m = /\/line\/detail\/(\d+)/.exec(hits[0].href || '');
  return m ? m[1] : null;
}

/** 本文 → 行の配列（改行コードを揃える）（純粋関数） */
export function toLines(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split('\n');
}

/** 入力欄の内容と送りたい本文が一致するか（空白の差は無視）（純粋関数） */
export function sameText(a, b) {
  const norm = (s) => String(s || '').replace(/\s+/g, '');
  return norm(a) === norm(b);
}

/** 友だちリストを生徒名で検索し、管理IDが一致する友だちの内部IDを返す */
export async function findMemberId(page, { name, manageId, log }) {
  await page.goto(LSTEP_BASE + '/line/show', { waitUntil: 'domcontentloaded' });
  const box = page.locator('input[placeholder="友だち名を検索"]').first();
  await box.waitFor({ state: 'visible' });
  await box.fill(name);
  await page.getByRole('button', { name: '検索', exact: true }).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  const rows = await page.locator('table tr').evaluateAll((trs) => trs
    .map((tr) => {
      const a = tr.querySelector('a[href^="/line/detail/"]');
      return a ? { href: a.getAttribute('href'), text: tr.innerText } : null;
    })
    .filter(Boolean));
  const id = pickMemberId(rows, manageId);
  log(`   検索「${name}」→ ${rows.length}行 / 管理ID一致: ${id ? 'あり' : 'なし'}`);
  return id;
}

/** 個別トーク画面の右側（友だち情報の表）に表示される管理ID。<td><p>管理ID</p></td><td>数字</td> */
async function readPanelManageId(page) {
  return page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('td p, td'))
      .find((e) => e.children.length === 0 && e.textContent.trim() === '管理ID');
    const td = label && label.closest('td');
    const value = td && td.nextElementSibling ? td.nextElementSibling.textContent.trim() : '';
    return /^\d{6,20}$/.test(value) ? value : null;
  });
}

/**
 * 1件送信。dryRun なら入力までして送信ボタンは押さない（入力欄は空に戻す）
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function sendToMember(page, { memberId, manageId, text, dryRun, log, shot }) {
  await page.goto(`${LSTEP_BASE}/line/visual?member=${memberId}`, { waitUntil: 'domcontentloaded' });
  const editor = page.locator('.tiptap.ProseMirror[contenteditable="true"]').first();
  await editor.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);

  const shownId = await readPanelManageId(page);
  if (shownId !== String(manageId)) {
    await shot('mismatch');
    return { ok: false, error: `開いたトークの管理ID(${shownId || '不明'})が送信先(${manageId})と一致しないため中止` };
  }

  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  const lines = toLines(text);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) await page.keyboard.press('Enter'); // Enter は改行（Shift+Enter が送信）
    if (lines[i]) await page.keyboard.insertText(lines[i]);
  }
  const typed = await editor.innerText();
  if (!sameText(typed, text)) {
    await shot('typed_mismatch');
    return { ok: false, error: '入力欄の内容が本文と一致しないため中止' };
  }
  await shot('before_send');

  if (dryRun) {
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    log('   DRY RUN：送信ボタンは押していません');
    return { ok: true, dryRun: true };
  }

  const sendBtn = page.locator('button', { hasText: /^\s*send\s*$/ }).last();
  await sendBtn.click();
  // 送信されると入力欄が空になり、トーク欄に本文の1行目が出る
  const firstLine = lines.find((l) => l.trim()) || '';
  await page.waitForFunction(() => {
    const ed = document.querySelector('.tiptap.ProseMirror');
    return ed && ed.innerText.trim() === '';
  }, null, { timeout: 20000 });
  await page.getByText(firstLine.slice(0, 30), { exact: false }).last().waitFor({ state: 'visible', timeout: 20000 });
  await shot('after_send');
  return { ok: true };
}

/**
 * キューのジョブをまとめて送信
 * @param {object} p
 * @param {import('playwright-core').Browser} p.browser
 * @param {{get:Function, put:Function}} p.storage
 * @param {Array<{jobId, manageId, studentName, type, text}>} p.jobs
 * @returns {Promise<{ status: 'success'|'needs_login', results: Array<{jobId, ok, error?}> }>}
 */
export async function runSender({ browser, storage, jobs, runId, loginUrl = LSTEP_BASE + '/', accountName = '', dryRun = false, log = console.log }) {
  const session = await loadSession(storage);
  if (!session) return { status: 'needs_login', results: [] };

  const context = await browser.newContext({ storageState: session, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  let current = '';
  const shot = async (name) => {
    try {
      await storage.put(`sender/${runId}/${current}_${name}.png`, await page.screenshot({ fullPage: false }), 'image/png');
    } catch { /* 失敗は無視 */ }
  };

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    if (await isLoginPage(page)) return { status: 'needs_login', results: [] };
    await ensureAccount(page, accountName, log);

    const cacheBuf = await storage.get(MEMBER_CACHE_KEY);
    const members = cacheBuf ? JSON.parse(cacheBuf.toString('utf8')) : {};
    let cacheDirty = false;
    const results = [];

    for (const job of jobs) {
      current = job.jobId;
      log(`▶ ${job.jobId} ${job.type} → ${job.studentName}（管理ID ${job.manageId}）`);
      try {
        let memberId = members[job.manageId];
        if (!memberId) {
          memberId = await findMemberId(page, { name: job.studentName, manageId: job.manageId, log });
          if (!memberId) {
            results.push({ jobId: job.jobId, ok: false, error: `友だちリストで「${job.studentName}」(管理ID ${job.manageId}) が1人に特定できません` });
            continue;
          }
          members[job.manageId] = memberId;
          cacheDirty = true;
        }
        let r = await sendToMember(page, { memberId, manageId: job.manageId, text: job.text, dryRun, log, shot });
        if (!r.ok && /一致しない/.test(r.error || '') && members[job.manageId]) {
          // キャッシュが古い可能性 → 検索し直して1回だけ再試行
          delete members[job.manageId];
          cacheDirty = true;
          const again = await findMemberId(page, { name: job.studentName, manageId: job.manageId, log });
          if (again && again !== memberId) {
            members[job.manageId] = again;
            r = await sendToMember(page, { memberId: again, manageId: job.manageId, text: job.text, dryRun, log, shot });
          }
        }
        log(r.ok ? '   ✅ 送信OK' : '   ❌ ' + r.error);
        results.push({ jobId: job.jobId, ok: r.ok, error: r.error, dryRun: r.dryRun });
      } catch (e) {
        await shot('error');
        log('   ❌ ' + e.message);
        results.push({ jobId: job.jobId, ok: false, error: e.message });
      }
    }

    if (cacheDirty) await storage.put(MEMBER_CACHE_KEY, JSON.stringify(members), 'application/json');
    try { await saveSession(storage, await context.storageState()); } catch { /* 無視 */ }
    return { status: 'success', results };
  } finally {
    await context.close().catch(() => {});
  }
}
