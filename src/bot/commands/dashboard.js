const queries = require('../../db/queries');
const templates = require('../templates');

async function handleDashboard(client, event, text) {
  const replyToken = event.replyToken;

  // 特定編集者の進捗
  const editorMatch = text.match(/^進捗\s*[@＠](.+)$/);
  if (editorMatch) {
    const editorName = editorMatch[1].trim();
    const projects = queries.getProjectsByEditorName(editorName);
    return client.replyMessage({
      replyToken,
      messages: [{
        type: 'text',
        text: templates.editorProjectListMessage(editorName, projects),
      }],
    });
  }

  // 全体ダッシュボード
  const overdue = queries.getOverdueProjects();
  const todayDeadline = queries.getTodayDeadlineProjects();
  const inProgress = queries.getUpcomingProjects();
  const completedThisWeek = queries.getCompletedProjectsThisWeek();

  const msg = templates.dashboardMessage(
    overdue,
    todayDeadline,
    inProgress,
    completedThisWeek.count
  );

  return client.replyMessage({
    replyToken,
    messages: [{ type: 'text', text: msg }],
  });
}

module.exports = { handleDashboard };
