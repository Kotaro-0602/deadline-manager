const express = require('express');
const { middleware, messagingApi } = require('@line/bot-sdk');
const cron = require('node-cron');
const { getDb } = require('./db/init');
const { handleMessage } = require('./bot/handler');
const { runReminder } = require('./cron/reminder');
const { runAlert } = require('./cron/alert');
const { runAutoStart } = require('./cron/auto-start');
const { runRecruitment } = require('./cron/recruitment');
const { initSheets, syncAllData, isEnabled: isSheetsEnabled } = require('./sheets/sync');
const { reverseSyncFromSheets } = require('./sheets/reverse-sync');
const { restoreFromSheets, backupToSheets } = require('./db/backup');

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
    try {
      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: `⚠️ エラーが発生しました。\n${err.message}` }],
      });
    } catch (replyErr) {
      console.error(`[WEBHOOK] Failed to send error reply:`, replyErr.message);
    }
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

  // --- データ修正: 毎回確実に適用 ---
  try {
    const db = getDb();
    let migrated = false;

    // 案件9,10,11,12を削除
    const idsToDelete = [9, 10, 11, 12];
    const existing = idsToDelete.filter(id => db.prepare('SELECT id FROM projects WHERE id = ?').get(id));
    if (existing.length > 0) {
      existing.forEach(id => db.prepare('DELETE FROM projects WHERE id = ?').run(id));
      console.log(`[MIGRATION] Deleted projects #${existing.join(', #')}.`);
      migrated = true;
    }

    // 案件19: おびともみの提出日時
    const p19 = db.prepare('SELECT id FROM projects WHERE id = 19').get();
    if (p19) {
      db.prepare(`
        UPDATE projects SET
          first_draft_at = '2026-03-25 14:05',
          revision_1_at = '2026-03-26 16:44',
          completed_at = '2026-03-28 11:39',
          deadline = '2026-03-28',
          status = 'completed', updated_at = datetime('now', 'localtime')
        WHERE id = 19
      `).run();
      console.log('[MIGRATION] Updated project #19 timestamps.');
      migrated = true;
    }

    // 案件16: 未来人AI＆セミナーver/小山寛治
    const p16 = db.prepare('SELECT id FROM projects WHERE id = 16').get();
    if (p16) {
      db.prepare(`
        UPDATE projects SET
          first_draft_at = '2026-03-22 22:19',
          revision_1_at = '2026-03-23 19:47',
          completed_at = '2026-03-24 16:27',
          status = 'completed', updated_at = datetime('now', 'localtime')
        WHERE id = 16
      `).run();
      console.log('[MIGRATION] Updated project #16 timestamps.');
      migrated = true;
    }

    // 案件14: 格付け/川俣勝翼
    const p14 = db.prepare('SELECT id FROM projects WHERE id = 14').get();
    if (p14) {
      db.prepare(`
        UPDATE projects SET
          first_draft_at = '2026-03-16 23:05',
          revision_1_at = '2026-03-20 13:39',
          completed_at = '2026-03-21 21:52',
          status = 'completed', updated_at = datetime('now', 'localtime')
        WHERE id = 14
      `).run();
      console.log('[MIGRATION] Updated project #14 timestamps.');
      migrated = true;
    }

    // 編集者14(白山 友康/未連携)の案件を編集者13(白山友康/連携済)に移行して削除
    const e14 = db.prepare('SELECT id FROM editors WHERE id = 14').get();
    if (e14) {
      db.prepare('UPDATE projects SET editor_id = 13 WHERE editor_id = 14').run();
      db.prepare('DELETE FROM editors WHERE id = 14').run();
      console.log('[MIGRATION] Moved projects from editor #14 to #13, deleted editor #14.');
      migrated = true;
    }

    // 編集者9,10(高須賀綾)を削除（参照する案件のeditor_idもクリア）
    const editorIds = [9, 10];
    const existingEditors = editorIds.filter(id => db.prepare('SELECT id FROM editors WHERE id = ?').get(id));
    if (existingEditors.length > 0) {
      existingEditors.forEach(id => {
        db.prepare('UPDATE projects SET editor_id = NULL WHERE editor_id = ?').run(id);
        db.prepare('DELETE FROM editors WHERE id = ?').run(id);
      });
      console.log(`[MIGRATION] Deleted editors #${existingEditors.join(', #')}.`);
      migrated = true;
    }

    if (migrated) {
      console.log('[MIGRATION] Data fixes applied. Will sync after reverse-sync.');
    }
  } catch (e) {
    console.error('[MIGRATION] Data fix failed:', e.message);
  }

  // 起動時に必ずSheetsを同期（逆同期 → 正同期の順）
  if (isSheetsEnabled()) {
    try {
      await reverseSyncFromSheets();
      await syncAllData();
      console.log('[STARTUP] Synced all data to Sheets.');
    } catch (e) {
      console.error('[STARTUP] Sheets sync failed:', e.message);
    }
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

  // 編集者募集通知: 毎朝10:00（未アサイン案件をグループに通知）
  cron.schedule('0 10 * * *', () => {
    console.log('[CRON] Running recruitment notification...');
    runRecruitment(client);
  }, { timezone: 'Asia/Tokyo' });

  // Google Sheets同期: 2分ごと（逆同期 → 正同期）
  cron.schedule('*/2 * * * *', async () => {
    if (isSheetsEnabled()) {
      console.log('[CRON] Syncing Google Sheets...');
      await reverseSyncFromSheets();
      await syncAllData();
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
