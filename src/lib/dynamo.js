import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CONFIG } from './config.js';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export async function getMapping(discordUserId, step) {
  const r = await ddb.send(new GetCommand({
    TableName: CONFIG.mappingTable,
    Key: { discord_user_id: String(discordUserId), step: String(step) },
  }));
  return r.Item || null;
}

export async function putMapping(item) {
  await ddb.send(new PutCommand({ TableName: CONFIG.mappingTable, Item: item }));
}

export async function updateMappingFields(discordUserId, step, fields) {
  const names = {}, values = {}, sets = [];
  Object.entries(fields).forEach(([k, v], i) => {
    names[`#k${i}`] = k;
    values[`:v${i}`] = v;
    sets.push(`#k${i} = :v${i}`);
  });
  await ddb.send(new UpdateCommand({
    TableName: CONFIG.mappingTable,
    Key: { discord_user_id: String(discordUserId), step: String(step) },
    UpdateExpression: 'SET ' + sets.join(', '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

/** 同じ discord_user_id の全step行（STEP0再利用用） */
export async function queryByDiscordId(discordUserId) {
  const r = await ddb.send(new QueryCommand({
    TableName: CONFIG.mappingTable,
    KeyConditionExpression: 'discord_user_id = :d',
    ExpressionAttributeValues: { ':d': String(discordUserId) },
  }));
  return r.Items || [];
}

/** GSI by-status で特定ステータスの行を取得（書き戻し用） */
export async function queryByStatus(status) {
  let items = [];
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: CONFIG.mappingTable,
      IndexName: 'by-status',
      KeyConditionExpression: 'match_status = :s',
      ExpressionAttributeValues: { ':s': status },
      ExclusiveStartKey,
    }));
    items = items.concat(r.Items || []);
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}
