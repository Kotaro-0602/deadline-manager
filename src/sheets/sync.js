const { google } = require('googleapis');
const dayjs = require('dayjs');
const queries = require('../db/queries');

const STATUS_LABELS = {
  unstarted: '未着手',
  in_progress: '作業中',
  submitted: '提出済',
  first_draft: '初稿提出済',
  revision: '修正中',
  revision_1: '修正1提出済',
  revision_2: '修正2提出済',
  revision_3: '修正3提出済',
  completed: '完了',
};

let sheetsClient = null;
let auth = null;

function initSheets() {
  const credentialsEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  if (!credentialsEnv || !spreadsheetId) {
    console.log('[SHEETS] Google Sheets sync is disabled (credentials not configured)');
    return false;
  }

  try {
    let credentials;

    // ファイルパスの場合（ローカル開発用）
    if (credentialsEnv.startsWith('/') || credentialsEnv.startsWith('.')) {
      credentials = require(credentialsEnv);
    } else {
      // JSON文字列の場合（Renderデプロイ用）
      try {
        credentials = JSON.parse(credentialsEnv);
      } catch (e) {
        // base64エンコードの場合
        credentials = JSON.parse(Buffer.from(credentialsEnv, 'base64').toString('utf-8'));
      }
    }

    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('[SHEETS] Google Sheets sync initialized.');
    return true;
  } catch (err) {
    console.error('[SHEETS] Failed to initialize:', err.message);
    return false;
  }
}

function isEnabled() {
  return sheetsClient !== null;
}

async function syncAllData() {
  if (!isEnabled()) return;

  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  try {
    // === 案件一覧シート ===
    const allProjects = queries.getAllProjects();
    const projectRows = [
      ['案件ID', '案件名', '担当編集者', '発注者', '着手日', '納期', 'ステータス', '初稿提出', '修正1提出', '修正2提出', '修正3提出', '納品日', '備考', '登録日', '更新日', '遅延日数'],
    ];

    const today = dayjs();
    for (const p of allProjects) {
      const deadline = dayjs(p.deadline);
      let daysOverdue = 0;
      if (p.status === 'completed' && p.completed_at) {
        // 完了済み: 納品日が納期を超えていたら遅延日数を記録
        const completedDay = dayjs(p.completed_at);
        if (completedDay.isAfter(deadline, 'day')) {
          daysOverdue = completedDay.diff(deadline, 'day');
        }
      } else if (p.status !== 'completed' && p.status !== 'submitted') {
        // 未完了: 今日が納期を超えていたら遅延中
        if (today.isAfter(deadline, 'day')) {
          daysOverdue = today.diff(deadline, 'day');
        }
      }

      const fmtTs = (val) => val ? dayjs(val).format('YYYY/MM/DD HH:mm') : '';

      projectRows.push([
        p.id,
        p.title,
        p.editor_name || '未割当',
        p.client_name || '',
        p.start_date ? dayjs(p.start_date).format('YYYY/MM/DD') : '',
        dayjs(p.deadline).format('YYYY/MM/DD'),
        STATUS_LABELS[p.status] || p.status,
        fmtTs(p.first_draft_at),
        fmtTs(p.revision_1_at),
        fmtTs(p.revision_2_at),
        fmtTs(p.revision_3_at),
        fmtTs(p.completed_at),
        p.note || '',
        dayjs(p.created_at).format('YYYY/MM/DD HH:mm'),
        dayjs(p.updated_at).format('YYYY/MM/DD HH:mm'),
        daysOverdue > 0 ? `${daysOverdue}日超過` : '',
      ]);
    }

    // === 編集者一覧シート ===
    const allEditors = queries.getAllEditors();
    const editorRows = [
      ['編集者ID', '名前', 'LINE連携', 'ステータス', '担当案件数', '登録日'],
    ];

    for (const e of allEditors) {
      const editorProjects = queries.getProjectsByEditorId(e.id);
      editorRows.push([
        e.id,
        e.name,
        e.line_user_id ? '連携済' : '未連携',
        e.status === 'active' ? '稼働中' : '非稼働',
        editorProjects.length,
        dayjs(e.created_at).format('YYYY/MM/DD'),
      ]);
    }

    // === ダッシュボードシート ===
    const overdue = queries.getOverdueProjects();
    const todayDeadline = queries.getTodayDeadlineProjects();
    const upcoming = queries.getUpcomingProjects();
    const completedThisWeek = queries.getCompletedProjectsThisWeek();

    const dashboardRows = [
      ['📊 納期管理ダッシュボード', '', '', ''],
      ['最終更新', dayjs().format('YYYY/MM/DD HH:mm'), '', ''],
      ['', '', '', ''],
      ['項目', '件数', '', ''],
      ['🔴 遅延中', overdue.length, '', ''],
      ['🟡 本日納期', todayDeadline.length, '', ''],
      ['🟢 進行中', upcoming.length, '', ''],
      ['✅ 今週完了', completedThisWeek.count, '', ''],
      ['', '', '', ''],
      ['--- 遅延案件 ---', '', '', ''],
      ['案件名', '担当', '納期', '超過日数'],
    ];

    for (const p of overdue) {
      const daysOver = Math.floor(p.days_overdue);
      dashboardRows.push([
        p.title,
        p.editor_name,
        dayjs(p.deadline).format('YYYY/MM/DD'),
        `${daysOver}日`,
      ]);
    }

    // シートをクリアして書き込み
    await clearAndWrite(spreadsheetId, '案件一覧', projectRows);
    await clearAndWrite(spreadsheetId, '編集者一覧', editorRows);
    await clearAndWrite(spreadsheetId, 'ダッシュボード', dashboardRows);

    console.log(`[SHEETS] Synced ${allProjects.length} projects, ${allEditors.length} editors.`);
  } catch (err) {
    console.error('[SHEETS] Sync failed:', err.message);
  }
}

async function clearAndWrite(spreadsheetId, sheetName, rows) {
  try {
    // シートが存在するか確認、なければ作成
    await ensureSheet(spreadsheetId, sheetName);

    // クリア
    await sheetsClient.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    // 書き込み
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  } catch (err) {
    console.error(`[SHEETS] Failed to write sheet "${sheetName}":`, err.message);
  }
}

async function ensureSheet(spreadsheetId, sheetName) {
  try {
    const res = await sheetsClient.spreadsheets.get({ spreadsheetId });
    const existing = res.data.sheets.map(s => s.properties.title);

    if (!existing.includes(sheetName)) {
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: sheetName } },
          }],
        },
      });
      console.log(`[SHEETS] Created sheet: ${sheetName}`);
    }
  } catch (err) {
    console.error(`[SHEETS] ensureSheet error:`, err.message);
  }
}

function getSheetsClient() {
  return sheetsClient;
}

function getSpreadsheetId() {
  return process.env.GOOGLE_SPREADSHEET_ID;
}

module.exports = { initSheets, syncAllData, isEnabled, getSheetsClient, getSpreadsheetId, ensureSheet };
