const queries = require('../db/queries');
const { reminderMessage, withMention } = require('../bot/templates');
const { triggerBackup } = require('../db/backup');
const dayjs = require('dayjs');

async function runReminder(client) {
  const groupId = process.env.AD_TEAM_GROUP_ID;
  if (!groupId) {
    console.warn('[REMINDER] AD_TEAM_GROUP_ID is not set. Skipping reminders.');
    return;
  }

  // 2日前・1日前リマインド
  for (const daysAhead of [2, 1]) {
    const projects = queries.getProjectsDueSoon(daysAhead);
    for (const project of projects) {
      const logType = `reminder_${daysAhead}day`;
      const alreadySent = queries.getTodayReminderLog(project.id, logType);
      if (alreadySent) continue;

      try {
        const deadlineStr = dayjs(project.deadline).format('M月D日');
        let text = `⏰ 納期リマインド\n━━━━━━━━━━━━━━━━\n`;
        text += `案件: ${project.title}\n`;
        text += `納期: ${deadlineStr}（あと${daysAhead}日）\n`;
        text += `ステータス: ${project.status === 'first_draft_submitted' ? '初稿提出済' : project.status === 'in_progress' ? '作業中' : project.status}\n`;

        if (project.editor_line_id) {
          const msg = withMention(text, project.editor_name, project.editor_line_id);
          await client.pushMessage({ to: groupId, messages: [msg] });
        } else {
          text += `担当: ${project.editor_name || '未定'}\n`;
          await client.pushMessage({ to: groupId, messages: [{ type: 'text', text }] });
        }
        queries.createReminderLog(project.id, logType);
        console.log(`[REMINDER] ${daysAhead}day reminder sent for project #${project.id} to group`);
      } catch (err) {
        console.error(`[REMINDER] Failed to send ${daysAhead}day reminder for project #${project.id}:`, err.message);
      }
    }
  }

  // 当日リマインド
  const todayProjects = queries.getTodayDeadlineProjects();
  for (const project of todayProjects) {
    const alreadySent = queries.getTodayReminderLog(project.id, 'reminder_today');
    if (alreadySent) continue;

    try {
      const deadlineStr = dayjs(project.deadline).format('M月D日');
      let text = `🔥 本日納期！\n━━━━━━━━━━━━━━━━\n`;
      text += `案件: ${project.title}\n`;
      text += `納期: ${deadlineStr}（今日）\n`;
      text += `ステータス: ${project.status === 'first_draft_submitted' ? '初稿提出済' : project.status === 'in_progress' ? '作業中' : project.status}\n`;

      if (project.editor_line_id) {
        const msg = withMention(text, project.editor_name, project.editor_line_id);
        await client.pushMessage({ to: groupId, messages: [msg] });
      } else {
        text += `担当: ${project.editor_name || '未定'}\n`;
        await client.pushMessage({ to: groupId, messages: [{ type: 'text', text }] });
      }
      queries.createReminderLog(project.id, 'reminder_today');
      console.log(`[REMINDER] Today reminder sent for project #${project.id} to group`);
    } catch (err) {
      console.error(`[REMINDER] Failed to send today reminder for project #${project.id}:`, err.message);
    }
  }

  // 初稿提出リマインド（着手から2日目の朝）
  const firstDraftProjects = queries.getFirstDraftReminderProjects();
  for (const project of firstDraftProjects) {
    const alreadySent = queries.getTodayReminderLog(project.id, 'first_draft_reminder');
    if (alreadySent) continue;

    try {
      let text = `📝 初稿提出リマインド\n━━━━━━━━━━━━━━━━\n`;
      text += `案件: ${project.title}\n`;
      text += `本日の21時までに初稿の提出をよろしくお願いいたします。`;

      if (project.editor_line_id) {
        const msg = withMention(text, project.editor_name, project.editor_line_id);
        await client.pushMessage({ to: groupId, messages: [msg] });
      } else {
        text += `\n担当: ${project.editor_name || '未定'}`;
        await client.pushMessage({ to: groupId, messages: [{ type: 'text', text }] });
      }
      queries.createReminderLog(project.id, 'first_draft_reminder');
      console.log(`[REMINDER] First draft reminder sent for project #${project.id}`);
    } catch (err) {
      console.error(`[REMINDER] Failed to send first draft reminder for project #${project.id}:`, err.message);
    }
  }

  // 超過リマインド
  const overdueProjects = queries.getOverdueProjects();
  for (const project of overdueProjects) {
    const alreadySent = queries.getTodayReminderLog(project.id, 'overdue');
    if (alreadySent) continue;

    try {
      const daysOver = Math.floor(
        (Date.now() - new Date(project.deadline).getTime()) / (1000 * 60 * 60 * 24)
      );
      let text = `🚨 納期超過アラート\n━━━━━━━━━━━━━━━━\n`;
      text += `案件: ${project.title}\n`;
      text += `納期: ${dayjs(project.deadline).format('M月D日')}（${daysOver}日超過）\n`;

      if (project.editor_line_id) {
        const msg = withMention(text, project.editor_name, project.editor_line_id);
        await client.pushMessage({ to: groupId, messages: [msg] });
      } else {
        text += `担当: ${project.editor_name || '未定'}\n`;
        await client.pushMessage({ to: groupId, messages: [{ type: 'text', text }] });
      }
      queries.createReminderLog(project.id, 'overdue');
      console.log(`[REMINDER] Overdue reminder sent for project #${project.id} to group`);
    } catch (err) {
      console.error(`[REMINDER] Failed to send overdue reminder for project #${project.id}:`, err.message);
    }
  }

  console.log('[REMINDER] Daily reminder completed.');
  triggerBackup();
}

module.exports = { runReminder };
