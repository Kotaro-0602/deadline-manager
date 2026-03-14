const queries = require('../db/queries');
const { reminderMessage, withMention } = require('../bot/templates');
const { triggerBackup } = require('../db/backup');

async function runReminder(client) {
  // 3日前〜2日前リマインド
  for (const daysAhead of [3, 2]) {
    const projects = queries.getProjectsDueSoon(daysAhead);
    for (const project of projects) {
      if (!project.editor_line_id) continue;
      const logType = `reminder_${daysAhead}day`;
      const alreadySent = queries.getTodayReminderLog(project.id, logType);
      if (alreadySent) continue;

      try {
        const text = reminderMessage('reminder_2day', project);
        const msg = withMention(text, project.editor_name, project.editor_line_id);
        await client.pushMessage({
          to: project.editor_line_id,
          messages: [msg],
        });
        queries.createReminderLog(project.id, logType);
        console.log(`[REMINDER] ${daysAhead}day reminder sent for project #${project.id} to ${project.editor_name}`);
      } catch (err) {
        console.error(`[REMINDER] Failed to send ${daysAhead}day reminder for project #${project.id}:`, err.message);
      }
    }
  }

  // 当日リマインド
  const todayProjects = queries.getTodayDeadlineProjects();
  for (const project of todayProjects) {
    if (!project.editor_line_id) continue;
    const alreadySent = queries.getTodayReminderLog(project.id, 'reminder_today');
    if (alreadySent) continue;

    try {
      const text = reminderMessage('reminder_today', project);
      const msg = withMention(text, project.editor_name, project.editor_line_id);
      await client.pushMessage({
        to: project.editor_line_id,
        messages: [msg],
      });
      queries.createReminderLog(project.id, 'reminder_today');
      console.log(`[REMINDER] Today reminder sent for project #${project.id} to ${project.editor_name}`);
    } catch (err) {
      console.error(`[REMINDER] Failed to send today reminder for project #${project.id}:`, err.message);
    }
  }

  // 超過リマインド（編集者へ）
  const overdueProjects = queries.getOverdueProjects();
  for (const project of overdueProjects) {
    if (!project.editor_line_id) continue;
    const alreadySent = queries.getTodayReminderLog(project.id, 'overdue');
    if (alreadySent) continue;

    try {
      const text = reminderMessage('overdue', project);
      const msg = withMention(text, project.editor_name, project.editor_line_id);
      await client.pushMessage({
        to: project.editor_line_id,
        messages: [msg],
      });
      queries.createReminderLog(project.id, 'overdue');
      console.log(`[REMINDER] Overdue reminder sent for project #${project.id} to ${project.editor_name}`);
    } catch (err) {
      console.error(`[REMINDER] Failed to send overdue reminder for project #${project.id}:`, err.message);
    }
  }

  console.log('[REMINDER] Daily reminder completed.');
  triggerBackup();
}

module.exports = { runReminder };
