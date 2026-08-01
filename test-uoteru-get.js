import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
const content = fs.readFileSync(envPath, 'utf-8');
const env = {};
content.split('\n').forEach(line => {
  const firstEqual = line.indexOf('=');
  if (firstEqual > 0) {
    const key = line.substring(0, firstEqual).trim();
    let value = line.substring(firstEqual + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.substring(1, value.length - 1);
    }
    env[key] = value;
  }
});

async function run() {
  const uri = env.MONGODB_URI || 'mongodb://127.0.0.1:27017/monitor';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const conn = await db.collection('connections').findOne({ name: 'uoteru' });
  await client.close();

  const res = await fetch(`http://localhost:3030/api/rclone/install?connectionId=${conn._id.toString()}&logFile=/tmp/rclone-install-1784987634753.log&sessionName=rclone-install-1784987634753`);
  
  const json = await res.json();
  console.log('GET Response:', json);
}
run();
