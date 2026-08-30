import { CONFIG, serverLabelForStep } from './config.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function errorHtml(message) {
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>エラー</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;padding:24px;text-align:center;color:#333;}
.box{max-width:500px;margin:60px auto;padding:32px;background:#fef2f2;border-radius:12px;border:1px solid #fecaca;}
h1{color:#dc2626;font-size:20px;}p{color:#555;line-height:1.6;}</style></head>
<body><div class="box"><h1>⚠️ エラー</h1><p>${esc(message)}</p></div></body></html>`;
}

export function completeHtml(step) {
  const serverName = serverLabelForStep(step);
  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>入室完了</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif;
background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;color:#333;}
.card{background:white;border-radius:16px;padding:40px 32px;max-width:420px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,.15);text-align:center;}
.icon{width:80px;height:80px;border-radius:50%;background:#10b981;margin:0 auto 24px;display:flex;align-items:center;justify-content:center;font-size:40px;color:#fff;animation:pop .4s ease-out;}
@keyframes pop{0%{transform:scale(0);}80%{transform:scale(1.1);}100%{transform:scale(1);}}
h1{font-size:22px;font-weight:bold;margin-bottom:16px;color:#1f2937;}
.server-name{display:inline-block;background:#ede9fe;color:#6d28d9;padding:6px 14px;border-radius:999px;font-size:14px;font-weight:bold;margin-bottom:20px;}
p{color:#4b5563;line-height:1.7;font-size:15px;margin-bottom:16px;}
.notice{background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 16px;border-radius:8px;text-align:left;font-size:14px;color:#78350f;margin-top:24px;line-height:1.6;}
.note-sub{margin-top:10px;font-size:12.5px;color:#92742a;line-height:1.55;}
.footer{margin-top:24px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;}
</style></head>
<body><div class="card">
<div class="icon">&#10003;</div>
<h1>入室完了しました！</h1>
<div class="server-name">${esc(serverName)}</div>
<p>ご認証ありがとうございます。<br>Discordサーバーへの入室が完了しました。</p>
<div class="notice"><strong>📱 次のステップ</strong><br>
LINEに戻ると次のご案内が届いています。<br>LINEアプリに戻ってご確認ください。
<div class="note-sub">※1〜2分送信にラグがございます。5分経過してもご案内が届かない場合はお問い合わせください。</div>
</div>
<div class="footer">このウィンドウは閉じて大丈夫です</div>
</div></body></html>`;
}
