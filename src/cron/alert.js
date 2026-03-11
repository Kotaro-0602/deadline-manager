const queries = require('../db/queries');
const { overdueAlertMessage } = require('../bot/templates');

async function runAlert(client) {
  const groupId = process.env.AD_TEAM_GROUP_ID;
  if (!groupId) {
    console.warn('[ALERT] AD_TEAM_GROUP_ID is not set. Skipping overdue alerts.');
    return;
  }

  const overdueProjects = queries.getOverdueProjects();
  if (overdueProjects.length === 0) {
    console.log('[ALERT] No overdue projects found.');
    return;
  }

  // 遅延案件をまとめて通知
  let alertText = `🚨 遅延アラート（${overdueProjects.length}件）\n━━━━━━━━━━━━━━━━\n\n`;
  for (const project of overdueProjects) {
    alertText += overdueAlertMessage(project) + '\n\n';
  }

  try {
    await client.pushMessage({
      to: groupId,
      messages: [{ type: 'text', text: alertText.trim() }],
    });
    console.log(`[ALERT] Overdue alert sent to group. ${overdueProjects.length} projects.`);
  } catch (err) {
    console.error('[ALERT] Failed to send overdue alert:', err.message);
  }
}

module.exports = { runAlert };
