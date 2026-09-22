// Chromium の起動。Lambda では @sparticuz/chromium、ローカルでは playwright 同梱のブラウザを使う。
//
// Lambda には GUI が無いので常にヘッドレス。人が操作する必要があるのは
// ログイン（CAPTCHA）だけで、それは scripts/session-login.js（ローカル）で行う。

export function isLambda(env = process.env) {
  return Boolean(env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * @param {{ headless?: boolean }} opts
 * @returns {Promise<import('playwright-core').Browser>}
 */
export async function launchBrowser({ headless = true } = {}) {
  if (isLambda()) {
    const [{ default: chromium }, { chromium: pw }] = await Promise.all([
      import('@sparticuz/chromium'),
      import('playwright-core'),
    ]);
    chromium.setGraphicsMode = false; // Lambda に GPU は無い。WebGL 関連の起動失敗を避ける
    return pw.launch({
      executablePath: await chromium.executablePath(),
      args: chromium.args,
      headless: true,
    });
  }
  // ローカル: playwright（devDependency）のブラウザを使う
  const { chromium: pw } = await import('playwright');
  return pw.launch({ headless });
}
