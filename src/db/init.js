const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'deadline-manager.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS editors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      line_user_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      line_user_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      editor_id INTEGER,
      client_id INTEGER,
      registered_by TEXT,
      deadline DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'unstarted',
      note TEXT,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (editor_id) REFERENCES editors(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS reminder_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      sent_at DATETIME DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
  `);

  // 既存DBへのマイグレーション（client_id カラムが無い場合に追加）
  try {
    db.prepare("SELECT client_id FROM projects LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE projects ADD COLUMN client_id INTEGER REFERENCES clients(id)");
    console.log('[DB] Added client_id column to projects table.');
  }

  // 既存DBへのマイグレーション（start_date カラムが無い場合に追加）
  try {
    db.prepare("SELECT start_date FROM projects LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE projects ADD COLUMN start_date DATE");
    console.log('[DB] Added start_date column to projects table.');
  }

  // 既存DBへのマイグレーション（提出日時カラムの追加）
  const submissionColumns = [
    'first_draft_at',   // 初稿提出日時
    'revision_1_at',    // 修正1提出日時
    'revision_2_at',    // 修正2提出日時
    'revision_3_at',    // 修正3提出日時
    'completed_at',     // 納品日時
  ];
  for (const col of submissionColumns) {
    try {
      db.prepare(`SELECT ${col} FROM projects LIMIT 1`).get();
    } catch (e) {
      db.exec(`ALTER TABLE projects ADD COLUMN ${col} DATETIME`);
      console.log(`[DB] Added ${col} column to projects table.`);
    }
  }
}

module.exports = { getDb };
