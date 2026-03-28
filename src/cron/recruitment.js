const queries = require('../db/queries');
const { recruitmentMessage } = require('../bot/templates');

/**
 * 編集者募集通知（毎朝10:00 JST）
 * 編集者未定（editor_id IS NULL）で登録から2日以上経過した案件を
 * 外注編集者グループに通知する
 */
async function runRecruitment(client) {
  const groupId = process.env.EDITOR_GROUP_ID;
  if (!groupId) {
    console.warn('[RECRUITMENT] EDITOR_GROUP_ID is not set. Skipping recruitment notification.');
    return;
  }

  const unassigned = queries.getUnassignedProjects(2);
  if (unassigned.length === 0) {
    console.log('[RECRUITMENT] No unassigned projects found.');
    return;
  }

  // 当日未通知の案件のみ抽出（重複防止）
  const toNotify = unassigned.filter(p => {
    const alreadySent = queries.getTodayReminderLog(p.id, 'recruitment');
    return !alreadySent;
  });

  if (toNotify.length === 0) {
    console.log('[RECRUITMENT] All unassigned projects already notified today.');
    return;
  }

  try {
    const msg = recruitmentMessage(toNotify);
    await client.pushMessage({
      to: groupId,
      messages: [msg],
    });

    // リマインドログに記録（重複防止用）
    for (const p of toNotify) {
      queries.createReminderLog(p.id, 'recruitment');
    }

    console.log(`[RECRUITMENT] Recruitment notification sent. ${toNotify.length} project(s).`);
  } catch (err) {
    console.error('[RECRUITMENT] Failed to send recruitment notification:', err.message);
  }
}

module.exports = { runRecruitment };
