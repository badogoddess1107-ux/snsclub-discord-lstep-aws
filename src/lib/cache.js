import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { CONFIG } from './config.js';

// Lステップ友だち一覧はサイズが大きい(〜1MB超)ためS3にキャッシュ（DynamoDBの400KB制限回避）
const s3 = new S3Client({});
const KEY = 'lstep-friends.json';
const TTL_MS = 10 * 60 * 1000; // 10分

export async function getFriendCache() {
  if (!CONFIG.friendCacheBucket) return null;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: CONFIG.friendCacheBucket, Key: KEY }));
    const body = await r.Body.transformToString();
    const parsed = JSON.parse(body);
    if (!parsed.fetched_at || Date.now() - parsed.fetched_at > TTL_MS) return null; // 期限切れ
    return parsed.friends || null;
  } catch {
    return null; // 未作成 or 取得失敗
  }
}

export async function putFriendCache(friends) {
  if (!CONFIG.friendCacheBucket) return;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: CONFIG.friendCacheBucket,
      Key: KEY,
      ContentType: 'application/json',
      Body: JSON.stringify({ fetched_at: Date.now(), friends }),
    }));
  } catch (e) {
    console.error('友だちキャッシュ保存失敗（無視）', e.message);
  }
}
