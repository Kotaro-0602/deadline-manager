const queries = require('../db/queries');
const { withMention } = require('../bot/templates');
const { triggerBackup } = require('../db/backup');
const dayjs = require('dayjs');

/**
 * 着手日が今日以前の未着手案件を自動的に「作業中」にする
 * 編集者にも通知を送る
 */
async function runAutoStart(client) {
  const projects = queries.getProjectsToAutoStart();

  if (projects.length === 0) {
    console.log('[AUTO-START] No projects to auto-start.');
    return;
  }

  for (const project of projects) {
    // ステータスを「作業中」に更新
    queries.updateProjectStatus(project.id, 'in_progress');
    console.log(`[AUTO-START] Project #${project.id} "${project.title}" auto-started.`);

    // 編集者に通知（LINE連携済みの場合）
    if (project.editor_line_id) {
      try {
        const notifyText = `📌 案件「${project.title}」の着手日（${dayjs(project.start_date).format('M/D')}）になりました。\nステータスを「作業中」に変更しました。\n\n納期: ${dayjs(project.deadline).format('YYYY/MM/DD')}\n\nよろしくお願いします！`;
        const msg = withMention(notifyText, project.editor_name, project.editor_line_id);
        await client.pushMessage({
          to: project.editor_line_id,
          messages: [msg],
        });
      } catch (err) {
        console.error(`[AUTO-START] Failed to notify editor for project #${project.id}:`, err.message);
      }
    }
  }

  console.log(`[AUTO-START] ${projects.length} project(s) auto-started.`);
  triggerBackup();
}

module.exports = { runAutoStart };
