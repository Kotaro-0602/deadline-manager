const dayjs = require('dayjs');

const STATUS_LABELS = {
  unstarted: '未着手',
  in_progress: '作業中',
  first_draft: '初稿提出済',
  submitted: '提出済',
  revision: '修正中',
  completed: '完了',
};

function statusLabel(status) {
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
  // revision_1 → 修正1提出済, revision_2 → 修正2提出済, ...
  const revMatch = status.match(/^revision_(\d+)$/);
  if (revMatch) return `修正${revMatch[1]}提出済`;
  return status;
}

function formatDate(dateStr) {
  return dayjs(dateStr).format('M/D');
}

function dashboardMessage(overdue, todayDeadline, inProgress, completedCount) {
  let msg = '📊 案件進捗ダッシュボード\n━━━━━━━━━━━━━━━━\n';

  if (overdue.length > 0) {
    msg += `\n🔴 遅延中（${overdue.length}件）\n─────────────\n`;
    for (const p of overdue) {
      const daysOver = Math.floor(p.days_overdue);
      msg += `#${String(p.id).padStart(3, '0')} ${p.title}\n`;
      msg += `　担当: ${p.editor_name} ｜ 納期: ${formatDate(p.deadline)}（${daysOver}日超過）\n\n`;
    }
  }

  if (todayDeadline.length > 0) {
    msg += `🟡 本日納期（${todayDeadline.length}件）\n─────────────\n`;
    for (const p of todayDeadline) {
      msg += `#${String(p.id).padStart(3, '0')} ${p.title}\n`;
      msg += `　担当: ${p.editor_name} ｜ 納期: ${formatDate(p.deadline)}\n\n`;
    }
  }

  if (inProgress.length > 0) {
    msg += `🟢 進行中（${inProgress.length}件）\n─────────────\n`;
    for (const p of inProgress) {
      msg += `#${String(p.id).padStart(3, '0')} ${p.title}\n`;
      msg += `　担当: ${p.editor_name} ｜ 納期: ${formatDate(p.deadline)} ｜ ${statusLabel(p.status)}\n\n`;
    }
  }

  msg += `✅ 完了（今週: ${completedCount}件）`;
  return msg;
}

function projectListMessage(projects) {
  if (projects.length === 0) {
    return '案件がありません。';
  }
  let msg = '📋 案件一覧\n━━━━━━━━━━━━━━━━\n\n';
  for (const p of projects) {
    const overdue = dayjs().isAfter(dayjs(p.deadline), 'day') && p.status !== 'completed' && p.status !== 'submitted';
    const mark = overdue ? '🔴 ' : '';
    msg += `${mark}#${String(p.id).padStart(3, '0')} ${p.title}\n`;
    let line = `　編集: ${p.editor_name}`;
    if (p.client_name) line += ` ｜ 発注: ${p.client_name}`;
    line += ` ｜ 納期: ${formatDate(p.deadline)} ｜ ${statusLabel(p.status)}`;
    msg += line + '\n\n';
  }
  return msg.trim();
}

function editorProjectListMessage(editorName, projects) {
  if (projects.length === 0) {
    return `${editorName}さんの案件はありません。`;
  }
  let msg = `📋 ${editorName}さんの案件一覧\n━━━━━━━━━━━━━━━━\n\n`;
  for (const p of projects) {
    msg += `#${String(p.id).padStart(3, '0')} ${p.title}\n`;
    msg += `　納期: ${formatDate(p.deadline)} ｜ ${statusLabel(p.status)}\n\n`;
  }
  return msg.trim();
}

function editorListMessage(editors) {
  if (editors.length === 0) {
    return '編集者が登録されていません。';
  }
  let msg = '👥 編集者一覧\n━━━━━━━━━━━━━━━━\n\n';
  for (const e of editors) {
    const linked = e.line_user_id ? '✅ LINE連携済' : '❌ 未連携';
    msg += `${e.id}. ${e.name}（${linked}）\n`;
  }
  return msg.trim();
}

function projectRegisteredMessage(project, editorName, clientName) {
  let msg = `✅ 案件登録完了！\n─────────────\n案件名: ${project.title}\n編集者: ${editorName}`;
  if (clientName) {
    msg += `\n発注者: ${clientName}`;
  }
  if (project.startDate) {
    msg += `\n着手日: ${dayjs(project.startDate).format('YYYY/MM/DD')}`;
  }
  msg += `\n納期: ${dayjs(project.deadline).format('YYYY/MM/DD')}\n備考: ${project.note || 'なし'}\n─────────────`;
  return msg;
}

function reminderMessage(type, project) {
  const title = project.title;
  const deadline = dayjs(project.deadline);
  const deadlineStr = deadline.format('M月D日');
  const daysLeft = deadline.diff(dayjs(), 'day');
  const daysOverdue = Math.abs(daysLeft);

  switch (type) {
    case 'reminder_2day':
      return `【リマインド】${title}の案件、納期は${deadlineStr}です（あと${daysLeft}日）`;
    case 'reminder_today':
      return `【本日納期】${title}の案件、本日が納期です。提出をお願いします`;
    case 'overdue':
      return `【納期超過】${title}の案件、納期（${deadlineStr}）を${daysOverdue}日過ぎています。状況を教えてください`;
    default:
      return '';
  }
}

function overdueAlertMessage(project) {
  const daysOver = Math.floor(
    (Date.now() - new Date(project.deadline).getTime()) / (1000 * 60 * 60 * 24)
  );
  return `【遅延アラート】編集者${project.editor_name} / 案件${project.title} / 納期${dayjs(project.deadline).format('M月D日')}（${daysOver}日超過）`;
}

function clientListMessage(clients) {
  if (clients.length === 0) {
    return '発注者が登録されていません。';
  }
  let msg = '🏢 発注者一覧\n━━━━━━━━━━━━━━━━\n\n';
  for (const c of clients) {
    const linked = c.line_user_id ? '✅ LINE連携済' : '❌ 未連携';
    msg += `${c.id}. ${c.name}（${linked}）\n`;
  }
  return msg.trim();
}

function helpMessage() {
  return `📖 使い方ガイド\n━━━━━━━━━━━━━━━━\n\n【広告チーム向け】\n・案件登録 案件名/編集者/発注者/納期\n　例: 案件登録 CM編集/田中/山田/3-20\n・進捗 → ダッシュボード\n・案件一覧 → 全案件リスト\n・編集者一覧 / 発注者一覧\n\n【編集者向け】\n・LINE連携 名前 → LINE連携\n・マイ案件 → 自分の案件一覧\n・着手 [番号] → 作業中に変更\n・提出 [番号] → 提出済に変更\n\n【発注者向け】\n・発注者連携 名前 → LINE連携\n・案件確認 → 発注案件の進捗確認\n\n・ヘルプ → この画面を表示`;
}

function newProjectNotification(project, editorName) {
  let msg = `📬 新しい案件が割り振られました\n─────────────\n案件名: ${project.title}`;
  if (project.startDate) {
    msg += `\n着手日: ${dayjs(project.startDate).format('YYYY/MM/DD')}`;
  }
  msg += `\n納期: ${dayjs(project.deadline).format('YYYY/MM/DD')}\n備考: ${project.note || 'なし'}\n─────────────\n着手したら「着手 ${project.title}」と送信してください。`;
  return msg;
}

module.exports = {
  statusLabel,
  formatDate,
  dashboardMessage,
  projectListMessage,
  editorProjectListMessage,
  editorListMessage,
  clientListMessage,
  projectRegisteredMessage,
  reminderMessage,
  overdueAlertMessage,
  helpMessage,
  newProjectNotification,
};
