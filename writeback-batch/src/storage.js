// 永続ストレージ（S3）。ローカル検証用にディレクトリ実装も持つ。
//
// 保存するもの:
//   session/storageState.json   ログイン済みセッション（Cookie等）。人がCAPTCHAを解いて更新する
//   runs/<実行ID>/export.csv     Lステップからエクスポートした元CSV
//   runs/<実行ID>/merged.csv     DiscordID を埋めたCSV（インポートしたもの）
//   runs/<実行ID>/*.png          各ステップのスクリーンショット（失敗時の調査用）
//   runs/<実行ID>/summary.json   結果サマリ
//   runs/latest.json             直近の結果（監視・確認用）
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import path from 'node:path';

export const SESSION_KEY = 'session/storageState.json';
export const LATEST_KEY = 'runs/latest.json';

export function runPrefix(runId) {
  return `runs/${runId}/`;
}

/** 実行IDは JST の日時（例: 2026-09-22_2200） */
export function makeRunId(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}_${p(jst.getUTCHours())}${p(jst.getUTCMinutes())}`;
}

export class S3Storage {
  constructor(bucket, client = new S3Client({})) {
    if (!bucket) throw new Error('WRITEBACK_BUCKET が未設定です');
    this.bucket = bucket;
    this.s3 = client;
  }
  async get(key) {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await r.Body.transformToByteArray());
    } catch (e) {
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
  async put(key, body, contentType = 'application/octet-stream') {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  describe() { return `s3://${this.bucket}`; }
}

/** ローカル検証用: ディレクトリをバケットに見立てる */
export class LocalStorage {
  constructor(baseDir) {
    this.baseDir = baseDir;
    fs.mkdirSync(baseDir, { recursive: true });
  }
  async get(key) {
    const p = path.join(this.baseDir, key);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  }
  async put(key, body) {
    const p = path.join(this.baseDir, key);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  describe() { return this.baseDir; }
}

/** 環境変数から適切な実装を選ぶ。WRITEBACK_LOCAL_DIR があればローカル */
export function storageFromEnv(env = process.env) {
  if (env.WRITEBACK_LOCAL_DIR) return new LocalStorage(env.WRITEBACK_LOCAL_DIR);
  return new S3Storage(env.WRITEBACK_BUCKET);
}

// ---- セッション ----
export async function loadSession(storage) {
  const buf = await storage.get(SESSION_KEY);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

export async function saveSession(storage, storageState) {
  await storage.put(SESSION_KEY, JSON.stringify(storageState), 'application/json');
}
