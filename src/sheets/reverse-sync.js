const dayjs = require('dayjs');
const queries = require('../db/queries');
const { getSheetsClient, getSpreadsheetId, isEnabled } = require('./sync');

// 日本語ステータス → DB enum の逆マップ
const REVERSE_STATUS = {
  '未着手': 'unstarted',
  '作業中': 'in_progress',
  '提出済': 'submitted',
  '初稿提出済': 'first_draft',
  '修正中': 'revision',
  '修正1提出済': 'revision_1',
  '修正2提出済': 'revision_2',
  '修正3提出済': 'revision_3',
  '完了': 'completed',
};

/**
 * スプシの案件一覧を読み取り、変更があればDBに反映する
 */
async function reverseSyncFromSheets() {
  if (!isEnabled()) return;

  const sheetsClient = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId,
      range: '案件一覧!A:L',
    });

    const rows = res.data.values;
    if (!rows || rows.length <= 1) {
      console.log('[REVERSE-SYNC] No data found in sheet.');
      return;
    }

    let updatedCount = 0;

    // ヘッダー行をスキップ（1行目）
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const projectId = parseInt(row[0], 10);
      const sheetStatus = row[6]; // ステータス列（G列）
      const sheetCompletedAt = row[11]; // 納品日列（L列）

      if (!projectId || isNaN(projectId)) continue;

      // DB の現在の状態を取得
      const project = queries.getProjectById(projectId);
      if (!project) continue;

      const dbStatus = project.status;
      const newStatus = REVERSE_STATUS[sheetStatus];

      // 不明なステータスはスキップ（「⚠️遅延」等の表示用ラベルを無視）
      if (!newStatus) continue;

      let changed = false;

      // ステータスが変更されている場合
      if (newStatus !== dbStatus) {
        queries.updateProjectStatus(projectId, newStatus);
        console.log(`[REVERSE-SYNC] Project #${projectId}: status ${dbStatus} → ${newStatus}`);
        changed = true;
      }

      // 完了ステータスで納品日が入っている場合、completed_at を更新
      if (newStatus === 'completed' && sheetCompletedAt) {
        const parsed = dayjs(sheetCompletedAt, 'YYYY/MM/DD HH:mm');
        if (parsed.isValid()) {
          const currentCompletedAt = project.completed_at;
          const newCompletedAt = parsed.format('YYYY-MM-DD HH:mm:ss');

          // completed_at が未設定、または異なる場合のみ更新
          if (!currentCompletedAt || dayjs(currentCompletedAt).format('YYYY-MM-DD HH:mm') !== parsed.format('YYYY-MM-DD HH:mm')) {
            queries.updateProjectCompletedAt(projectId, newCompletedAt);
            console.log(`[REVERSE-SYNC] Project #${projectId}: completed_at → ${newCompletedAt}`);
            changed = true;
          }
        }
      }

      if (changed) updatedCount++;
    }

    if (updatedCount > 0) {
      console.log(`[REVERSE-SYNC] Updated ${updatedCount} projects from Sheets.`);
    } else {
      console.log('[REVERSE-SYNC] No changes detected.');
    }
  } catch (err) {
    console.error('[REVERSE-SYNC] Failed:', err.message);
  }
}

module.exports = { reverseSyncFromSheets };
