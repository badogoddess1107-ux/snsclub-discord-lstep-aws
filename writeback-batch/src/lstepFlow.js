// Lステップ管理画面での export → merge → import の自動操作。
// lstep-discord-writeback/automate.js（Macで実績あり）の手順・セレクタをそのまま移植し、
// 「永続プロファイル」を「S3に保存した storageState」に置き換えた。
//
// 人が関与するのはログイン（CAPTCHA）だけ:
//   セッション切れを検知したら needs_login を返して終了 → Discord に通知
//   → 担当者が scripts/session-login.js で新しいセッションを保存 → 翌日から自動再開
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { toMap, mergeCsvBuffer } from './merge.js';
import { loadSession, saveSession, runPrefix } from './storage.js';

/** マッピング（管理ID,DiscordID）を取得。302 は fetch が自動追従する。file:// はローカル検証用 */
export async function fetchMap(mapUrl) {
  if (String(mapUrl).startsWith('file://')) {
    return toMap(fs.readFileSync(new URL(mapUrl), 'utf8'));
  }
  const res = await fetch(mapUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`マッピング取得に失敗: HTTP ${res.status}`);
  return toMap(await res.text());
}

/** ログイン画面かどうか（パスワード欄の有無で判定。automate.js と同じ） */
export async function isLoginPage(page) {
  return (await page.locator('input[type="password"]').count()) > 0;
}

/** ヘッダーに表示中のアカウント名などのテキスト（空白を正規化） */
export async function readHeaderText(page) {
  const t = await page.locator('header, nav, .navbar').first().innerText().catch(() => '');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * ヘッダーのテキストから「今このアカウントで操作しているか」を判定する（純粋関数）。
 * ドロップダウンを開くと他アカウントが「<名前>に切り替え」として並ぶため、
 * 「名前を含む」だけでは誤判定する。切替項目としての出現は除外する。
 */
export function isOnAccount(headerText, accountName) {
  if (!accountName) return true;
  const t = String(headerText || '');
  const withoutSwitchItems = t.split(accountName + 'に切り替え').join('');
  return withoutSwitchItems.includes(accountName);
}

/**
 * 目的のLステップアカウントで操作していることを保証する。
 * 1ユーザーが複数アカウント（SnsClub運営 / 勉強会 など）を持つため、ログイン直後の
 * 既定アカウントが目的と違うことがある。違えばヘッダーの「<名前>に切り替え」で切り替える。
 * 戻り値: { switched: boolean }。切り替えられなければ throw。
 */
export async function ensureAccount(page, accountName, log = () => {}) {
  if (!accountName) return { switched: false };
  if (isOnAccount(await readHeaderText(page), accountName)) {
    log(`   アカウント確認OK: ${accountName}`);
    return { switched: false };
  }
  log(`   別アカウントで開いています → 「${accountName}」に切り替えます`);
  // ヘッダー右端のアカウントメニュー（expand_more アイコン）を開く
  await page.locator('header, nav, .navbar').first().getByText('expand_more').last().click().catch(() => {});
  await page.waitForTimeout(500);
  const item = page.getByText(accountName + 'に切り替え', { exact: false }).first();
  if (!(await item.count())) {
    throw new Error(`アカウント「${accountName}」に切り替えられません（メニューに見つからない）。ログインユーザーの権限を確認してください`);
  }
  await item.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  if (!isOnAccount(await readHeaderText(page), accountName)) {
    throw new Error(`アカウント「${accountName}」への切り替えに失敗しました`);
  }
  log(`   切り替え完了: ${accountName}`);
  return { switched: true };
}

/**
 * @param {object} p
 * @param {import('playwright-core').Browser} p.browser
 * @param {{get:Function, put:Function, describe:Function}} p.storage
 * @param {string} p.runId
 * @param {string} p.mapUrl
 * @param {string} [p.loginUrl]
 * @param {string} [p.accountName]    操作対象のLステップアカウント名（例 "SnsClub運営"）。違えば切り替える
 * @param {boolean} [p.dryRun]        true: merged.csv を作るまで（インポートしない）
 * @param {boolean} [p.confirmImport] true: 「このデータを反映する」まで押す（本番反映）
 * @param {(msg:string)=>void} [p.log]
 */
export async function runWriteback({
  browser, storage, runId, mapUrl,
  loginUrl = 'https://manager.linestep.net/',
  accountName = '',
  dryRun = false, confirmImport = true, log = console.log,
}) {
  const prefix = runPrefix(runId);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'writeback-'));
  const exportPath = path.join(workDir, 'export.csv');
  const mergedPath = path.join(workDir, 'merged.csv');

  const session = await loadSession(storage);
  if (!session) {
    log('❌ 保存済みセッションがありません（初回は session:login が必要）');
    return { status: 'needs_login', reason: 'no_session' };
  }

  const context = await browser.newContext({
    storageState: session,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  const shot = async (name) => {
    try {
      const buf = await page.screenshot({ fullPage: true });
      await storage.put(prefix + name + '.png', buf, 'image/png');
    } catch { /* スクショ失敗は無視 */ }
  };

  try {
    // 1) ログイン確認 --------------------------------------------------------
    log('① ログイン確認…');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    if (await isLoginPage(page)) {
      await shot('1_login_required');
      log('🔐 セッション切れ。人によるログイン（画像認証）が必要です');
      return { status: 'needs_login', reason: 'session_expired' };
    }
    log('✅ 既存セッションでログイン済み');
    await ensureAccount(page, accountName, log);
    await shot('1_after_login');

    // 2) 友だちリスト → CSV操作 → CSVエクスポート ---------------------------
    log('② 友だちリスト → CSVエクスポート…');
    await page.getByRole('link', { name: /友だちリスト|友だち管理/ }).first().click().catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByText('CSV操作', { exact: false }).first().click().catch(() => {});
    await page.getByRole('button', { name: /CSVエクスポート$/ }).first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot('2_export_form');

    // 出力項目：友だち情報「DiscordID」を選択（"Discord…入室URL" を除外）
    // 2026/09 のUI変更で placeholder が「友だち情報名」→「友だち情報欄名」になったため両方を許容
    const infoBox = page.getByPlaceholder(/友だち情報(欄)?名を入力/);
    await infoBox.click();
    await infoBox.pressSequentially('DiscordID', { delay: 70 });
    await page.waitForTimeout(1000);
    let picked = false;
    const exactItem = page.getByText('DiscordID', { exact: true });
    if (await exactItem.count()) { await exactItem.first().click().catch(() => {}); picked = true; }
    if (!picked) {
      await page.locator('li,tr,div,span,a', { hasText: 'DiscordID' })
        .filter({ hasNotText: 'URL' }).first().click().catch(() => {});
    }
    await page.waitForTimeout(500);
    await shot('2c_after_select');

    await page.getByRole('button', { name: /この条件でダウンロード/ }).click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    await shot('3_after_export_request');

    // 3) 自分のエクスポート生成待ち → ダウンロード（過去のCSVを掴まない）----------
    log('③ エクスポート生成待ち → ダウンロード…');
    let myName = await page.getByText(/^member_\d{10,}$/).first().innerText().catch(() => null);
    log('   自分のエクスポート名: ' + (myName || '(取得できず→最新DL可能行を使用)'));
    let downloaded = false;
    for (let i = 0; i < 30 && !downloaded; i++) {
      let btn;
      if (myName) {
        const row = page.getByRole('row', { name: new RegExp(myName) });
        btn = (await row.count()) ? row.getByText('ダウンロード', { exact: true }) : null;
      }
      if (!btn || !(await btn.count())) {
        btn = myName ? null : page.getByText('ダウンロード', { exact: true }).first();
      }
      if (btn && (await btn.count())) {
        const [download] = await Promise.all([page.waitForEvent('download'), btn.first().click()]);
        await download.saveAs(exportPath);
        downloaded = true;
      } else {
        await page.waitForTimeout(8000);
        await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
        if (!myName) myName = await page.getByText(/^member_\d{10,}$/).first().innerText().catch(() => null);
      }
    }
    if (!downloaded) throw new Error('自分のエクスポートCSVのダウンロードに失敗（生成待ちタイムアウト）');
    await shot('4_after_download');
    const exportBuf = fs.readFileSync(exportPath);
    await storage.put(prefix + 'export.csv', exportBuf, 'text/csv');
    log(`   ダウンロード完了: ${exportBuf.length} bytes`);

    // 4) DiscordID列を充填 ------------------------------------------------------
    log('④ DiscordID列を充填…');
    const map = await fetchMap(mapUrl);
    const { buffer: mergedBuf, stats } = mergeCsvBuffer(exportBuf, map);
    fs.writeFileSync(mergedPath, mergedBuf);
    await storage.put(prefix + 'merged.csv', mergedBuf, 'text/csv');
    log(`   マッピング=${stats.mapCount} | 新規に埋めた=${stats.filled} | 既存保持=${stats.kept} | 対象外=${stats.notInMap}`);

    if (dryRun) {
      log('✅ DRY RUN: merged.csv を作成しました（インポートは実行していません）');
      await persistSession(context, storage, log);
      return { status: 'success', dryRun: true, stats };
    }
    if (stats.filled === 0) {
      log('ℹ️ 新規に埋める行がありません。インポートをスキップします');
      await persistSession(context, storage, log);
      return { status: 'success', skipped: true, stats };
    }

    // 5) CSVインポート ----------------------------------------------------------
    log('⑤ CSVインポート…');
    await page.getByRole('link', { name: /友だちリスト|友だち管理/ }).first().click().catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByText('CSV操作', { exact: false }).first().click().catch(() => {});
    await page.waitForTimeout(800);
    const importLoc = page.getByRole('button', { name: /CSVインポート/ })
      .or(page.getByRole('link', { name: /CSVインポート/ }))
      .or(page.locator('a:has-text("CSVインポート"), button:has-text("CSVインポート")'));
    let onImport = false;
    for (let t = 0; t < 3 && !onImport; t++) {
      await importLoc.first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      onImport = await page.getByText('CSVファイルアップロード').isVisible({ timeout: 8000 }).catch(() => false);
      if (!onImport) {
        await page.waitForTimeout(900);
        await page.getByText('CSV操作', { exact: false }).first().click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }
    await shot('5b_import_panel');
    if (!onImport) throw new Error('CSVインポート画面へ遷移できませんでした');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 15000 });
    await fileInput.setInputFiles(mergedPath);
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /CSVアップロード|アップロード/ }).first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    await shot('5d_import_preview');

    if (!confirmImport) {
      log('⏸ 取り込みプレビューまで進みました（本番反映していません）');
      await persistSession(context, storage, log);
      return { status: 'success', previewOnly: true, stats };
    }
    // 最終確定（本番反映）。空欄セルは既定「友だち情報を変更しない」のまま＝安全
    const confirmBtn = page.getByRole('button', { name: /このデータを反映する|反映する/ })
      .or(page.getByRole('link', { name: /このデータを反映する|反映する/ }))
      .or(page.locator('a:has-text("反映する"), button:has-text("反映する")'));
    await confirmBtn.first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
    await shot('6_after_import');
    log('✅ インポート完了（本番反映）');

    await persistSession(context, storage, log);
    return { status: 'success', stats };
  } catch (err) {
    await shot('ERROR');
    throw err;
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** 操作で更新された Cookie を保存し直す（セッション寿命を延ばす） */
async function persistSession(context, storage, log) {
  try {
    await saveSession(storage, await context.storageState());
    log('💾 セッションを保存し直しました');
  } catch (e) {
    log('セッション保存失敗（無視）: ' + e.message);
  }
}
