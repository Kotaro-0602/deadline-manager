const express = require('express');
const { middleware, messagingApi } = require('@line/bot-sdk');
const cron = require('node-cron');
const { getDb } = require('./db/init');
const { handleMessage } = require('./bot/handler');
const { runReminder } = require('./cron/reminder');
const { runAlert } = require('./cron/alert');
const { runAutoStart } = require('./cron/auto-start');
const { initSheets, syncAllData, isEnabled: isSheetsEnabled } = require('./sheets/sync');
const { restoreFromSheets } = require('./db/backup');

// .env読み込み（dotenvがなくても環境変数から取得可能）
try { require('dotenv').config(); } catch (e) { /* dotenv is optional */ }

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const app = express();

// ヘルスチェック（Render用）
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// LINE Webhook検証用
app.get('/webhook', (req, res) => {
  res.status(200).send('OK');
});

// LINE Webhookエンドポイント
app.post('/webhook', middleware(config), (req, res) => {
  console.log(`[WEBHOOK] Received ${req.body.events.length} event(s)`);
  Promise.all(req.body.events.map((event) => handleEvent(event)))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('[WEBHOOK] Error:', err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    console.log(`[WEBHOOK] Skipped event: type=${event.type}, messageType=${event.message?.type}`);
    return null;
  }
  console.log(`[WEBHOOK] Text message: "${event.message.text}" from ${event.source.type}/${event.source.userId}`);
  try {
    const result = await handleMessage(client, event);
    console.log(`[WEBHOOK] Handler result: ${result ? 'replied' : 'no reply'}`);
    return result;
  } catch (err) {
    console.error(`[WEBHOOK] Handler error:`, err);
    throw err;
  }
}

// === メイン起動（async化: リストア完了後にサーバー起動） ===
async function main() {
  // DB初期化
  getDb();
  console.log('Database initialized.');

  // Google Sheets初期化
  const sheetsOk = initSheets();

  // DBが空の場合、Google Sheetsバックアップから復元（Render再デプロイ対応）
  if (sheetsOk) {
    await restoreFromSheets();
  }

  // 自動着手: 毎朝8:00（着手日になった案件を自動で「作業中」に）
  cron.schedule('0 8 * * *', () => {
    console.log('[CRON] Running auto-start check...');
    runAutoStart(client);
  }, { timezone: 'Asia/Tokyo' });

  // 自動リマインド: 毎朝9:00
  cron.schedule('0 9 * * *', () => {
    console.log('[CRON] Running daily reminder...');
    runReminder(client);
  }, { timezone: 'Asia/Tokyo' });

  // 遅延アラート: 毎朝9:30
  cron.schedule('30 9 * * *', () => {
    console.log('[CRON] Running overdue alert...');
    runAlert(client);
  }, { timezone: 'Asia/Tokyo' });

  // Google Sheets同期: 毎時0分
  cron.schedule('0 * * * *', () => {
    if (isSheetsEnabled()) {
      console.log('[CRON] Syncing to Google Sheets...');
      syncAllData();
    }
  }, { timezone: 'Asia/Tokyo' });

  // サーバー起動
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  });

  // セルフping（Renderスリープ防止）
  if (process.env.RENDER_EXTERNAL_URL) {
    const https = require('https');
    setInterval(() => {
      https.get(`${process.env.RENDER_EXTERNAL_URL}/health`, () => {}).on('error', () => {});
    }, 4 * 60 * 1000); // 4分ごと
    console.log('[KEEP-ALIVE] Self-ping enabled for Render.');
  }
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
