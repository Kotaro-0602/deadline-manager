const queries = require('../db/queries');
const { overdueAlertMessage, withMultipleMentions } = require('../bot/templates');
const dayjs = require('dayjs');

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

  // 遅延案件をまとめて通知（textV2メンション付き）
  let alertText = `🚨 遅延アラート（${overdueProjects.length}件）\n━━━━━━━━━━━━━━━━\n\n`;
  const substitution = {};
  let mentionIdx = 0;

  for (const project of overdueProjects) {
    const daysOver = Math.floor(
      (Date.now() - new Date(project.deadline).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (project.editor_line_id) {
      // textV2プレースホルダーでメンション
      const key = `editor${mentionIdx}`;
      alertText += `【遅延アラート】{${key}} / 案件${project.title} / 納期${dayjs(project.deadline).format('M月D日')}（${daysOver}日超過）\n\n`;
      substitution[key] = {
        type: 'mention',
        mentionee: {
          type: 'user',
          userId: project.editor_line_id,
        },
      };
      mentionIdx++;
    } else {
      // LINE未連携の編集者は通常表示
      alertText += overdueAlertMessage(project) + '\n\n';
    }
  }

  try {
    const msg = withMultipleMentions(alertText.trim(), substitution);
    await client.pushMessage({
      to: groupId,
      messages: [msg],
    });
    console.log(`[ALERT] Overdue alert sent to group. ${overdueProjects.length} projects.`);
  } catch (err) {
    console.error('[ALERT] Failed to send overdue alert:', err.message);
  }
}

module.exports = { runAlert };
