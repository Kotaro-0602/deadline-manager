const { getDb } = require('./init');
const { getSheetsClient, getSpreadsheetId, ensureSheet, isEnabled } = require('../sheets/sync');

const BACKUP_SHEET = 'バックアップ';
let backupTimer = null;

/**
 * デバウンス付きバックアップトリガー（5秒以内の連続呼び出しを1回にまとめる）
 */
function triggerBackup() {
  if (!isEnabled()) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupToSheets().catch(err => {
      console.error('[BACKUP] Backup failed:', err.message);
    });
  }, 5000);
}

/**
 * 全テーブルをJSON化してGoogle Sheetsの「バックアップ」タブに保存
 */
async function backupToSheets() {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  if (!sheets || !spreadsheetId) return;

  const db = getDb();

  const data = {
    version: 1,
    timestamp: new Date().toISOString(),
    tables: {
      editors: db.prepare('SELECT * FROM editors').all(),
      clients: db.prepare('SELECT * FROM clients').all(),
      projects: db.prepare('SELECT * FROM projects').all(),
      reminder_logs: db.prepare('SELECT * FROM reminder_logs').all(),
    },
  };

  const json = JSON.stringify(data);

  await ensureSheet(spreadsheetId, BACKUP_SHEET);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${BACKUP_SHEET}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [[json]] },
  });

  console.log(`[BACKUP] Backed up: ${data.tables.editors.length} editors, ${data.tables.clients.length} clients, ${data.tables.projects.length} projects, ${data.tables.reminder_logs.length} reminder_logs`);
}

/**
 * サーバー起動時にDBが空なら、Google Sheetsバックアップから復元
 */
async function restoreFromSheets() {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  if (!sheets || !spreadsheetId) {
    console.log('[BACKUP] Sheets not configured, skipping restore.');
    return;
  }

  const db = getDb();

  // DBにデータがあればスキップ
  const editorCount = db.prepare('SELECT COUNT(*) as count FROM editors').get().count;
  const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get().count;
  if (editorCount > 0 || projectCount > 0) {
    console.log('[BACKUP] Database already has data, skipping restore.');
    return;
  }

  console.log('[BACKUP] Database is empty, attempting restore from Google Sheets...');

  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${BACKUP_SHEET}!A1`,
    });

    if (!res.data.values || !res.data.values[0] || !res.data.values[0][0]) {
      console.log('[BACKUP] No backup data found in Sheets.');
      return;
    }

    const data = JSON.parse(res.data.values[0][0]);
    if (!data.version || !data.tables) {
      console.log('[BACKUP] Invalid backup format.');
      return;
    }

    console.log(`[BACKUP] Found backup from ${data.timestamp}`);

    // トランザクションで一括リストア
    const restore = db.transaction(() => {
      // editors
      if (data.tables.editors && data.tables.editors.length > 0) {
        const insertEditor = db.prepare(
          'INSERT INTO editors (id, name, line_user_id, status, created_at) VALUES (?, ?, ?, ?, ?)'
        );
        for (const e of data.tables.editors) {
          insertEditor.run(e.id, e.name, e.line_user_id, e.status, e.created_at);
        }
      }

      // clients
      if (data.tables.clients && data.tables.clients.length > 0) {
        const insertClient = db.prepare(
          'INSERT INTO clients (id, name, line_user_id, status, created_at) VALUES (?, ?, ?, ?, ?)'
        );
        for (const c of data.tables.clients) {
          insertClient.run(c.id, c.name, c.line_user_id, c.status, c.created_at);
        }
      }

      // projects
      if (data.tables.projects && data.tables.projects.length > 0) {
        const insertProject = db.prepare(
          `INSERT INTO projects (id, title, editor_id, client_id, registered_by, deadline, status, note,
           start_date, first_draft_at, revision_1_at, revision_2_at, revision_3_at, completed_at,
           created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const p of data.tables.projects) {
          insertProject.run(
            p.id, p.title, p.editor_id, p.client_id, p.registered_by, p.deadline,
            p.status, p.note, p.start_date,
            p.first_draft_at, p.revision_1_at, p.revision_2_at, p.revision_3_at, p.completed_at,
            p.created_at, p.updated_at
          );
        }
      }

      // reminder_logs
      if (data.tables.reminder_logs && data.tables.reminder_logs.length > 0) {
        const insertLog = db.prepare(
          'INSERT INTO reminder_logs (id, project_id, type, sent_at) VALUES (?, ?, ?, ?)'
        );
        for (const r of data.tables.reminder_logs) {
          insertLog.run(r.id, r.project_id, r.type, r.sent_at);
        }
      }

      // sqlite_sequence を更新して自動採番IDが正しく続くようにする
      const tables = ['editors', 'clients', 'projects', 'reminder_logs'];
      for (const table of tables) {
        const maxId = db.prepare(`SELECT MAX(id) as max_id FROM ${table}`).get().max_id;
        if (maxId) {
          db.prepare(
            'INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES (?, ?)'
          ).run(table, maxId);
        }
      }
    });

    restore();

    const counts = {
      editors: data.tables.editors?.length || 0,
      clients: data.tables.clients?.length || 0,
      projects: data.tables.projects?.length || 0,
      reminder_logs: data.tables.reminder_logs?.length || 0,
    };
    console.log(`[BACKUP] Restored: ${counts.editors} editors, ${counts.clients} clients, ${counts.projects} projects, ${counts.reminder_logs} reminder_logs`);

  } catch (err) {
    console.error('[BACKUP] Restore failed:', err.message);
  }
}

module.exports = { backupToSheets, restoreFromSheets, triggerBackup };
