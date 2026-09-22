// Discord への結果通知（既存の手動対応アラートと同じ Webhook / スレッドを使う）。
// Webhook 未設定なら何もしない（デプロイを止めない）。

export function buildMessage(kind, detail = {}) {
  const mention = detail.mentionId ? `<@&${detail.mentionId}>` : '';
  switch (kind) {
    case 'success':
      return [
        '✅ DiscordID書き戻し（AWS）完了',
        `実行ID: ${detail.runId}`,
        `新規に埋めた: ${detail.filled}件 / 既存保持: ${detail.kept}件 / マッピング: ${detail.mapCount}件`,
        detail.dryRun ? '※ DRY RUN（インポートは実行していません）' : '',
      ].filter(Boolean).join('\n');
    case 'needs_login':
      return [
        mention,
        '⚠️ DiscordID書き戻し（AWS）: Lステップのログインセッションが切れています。',
        '担当者は手元のPCで下記を実行し、ブラウザで画像認証を解いてログインしてください。',
        '```',
        'cd aws-discord-lstep/writeback-batch && npm run session:login',
        '```',
        '完了すると翌日22時の実行から自動で再開します。',
        `実行ID: ${detail.runId}`,
      ].filter(Boolean).join('\n');
    case 'error':
      return [
        mention,
        '❌ DiscordID書き戻し（AWS）が失敗しました。',
        `実行ID: ${detail.runId}`,
        `エラー: ${String(detail.error || '').slice(0, 500)}`,
        detail.bucket ? `スクリーンショット: ${detail.bucket}/runs/${detail.runId}/` : '',
      ].filter(Boolean).join('\n');
    default:
      return `DiscordID書き戻し（AWS）: ${kind}`;
  }
}

export async function notifyDiscord(kind, detail = {}, env = process.env) {
  const webhook = env.DISCORD_ALERT_WEBHOOK_URL;
  if (!webhook) return { skipped: true };
  const threadId = env.DISCORD_ALERT_THREAD_ID;
  const mentionId = env.DISCORD_ALERT_MENTION_ID;
  const url = threadId ? webhook + (webhook.includes('?') ? '&' : '?') + 'thread_id=' + threadId : webhook;
  const content = buildMessage(kind, { ...detail, mentionId: kind === 'success' ? '' : mentionId });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: content.slice(0, 1900),
        allowed_mentions: mentionId ? { roles: [String(mentionId)] } : { parse: [] },
      }),
    });
    return { status: res.status };
  } catch (e) {
    console.error('Discord通知失敗（無視）', e.message);
    return { error: e.message };
  }
}
