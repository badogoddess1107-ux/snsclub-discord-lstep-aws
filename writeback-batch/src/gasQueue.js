// GAS（1on1講師マッチング）の Lステップ送信キュー。
// GAS Web App は POST に 302 を返し、リダイレクト先（GET）が結果を返すので redirect: 'follow' でよい。

async function call(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`送信キューAPI HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error('送信キューAPI: ' + json.error);
  return json.data;
}

/** 未送信ジョブを借りる（GAS 側で一定時間ロックされる） */
export async function pullJobs(url, token, limit = 10) {
  const data = await call(url, { action: 'lstep.pull', token, limit });
  return data.jobs || [];
}

/** 送信結果を返す */
export async function reportResults(url, token, results) {
  if (!results.length) return { updated: 0 };
  return call(url, { action: 'lstep.report', token, results });
}

/** 借りたジョブを未送信に戻す（ログイン切れなど、送信を試せなかったとき） */
export async function releaseJobs(url, token, jobIds) {
  if (!jobIds.length) return { released: 0 };
  return call(url, { action: 'lstep.release', token, jobIds });
}
