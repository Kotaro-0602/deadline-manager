const dayjs = require('dayjs');
const queries = require('../../db/queries');
const templates = require('../templates');

// 柔軟な日付パース（register-project.js と同じ仕様）
function parseDate(raw) {
  if (!raw) return null;
  const normalized = raw.replace(/\//g, '-');
  if (normalized.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
    const parsed = dayjs(normalized);
    if (parsed.isValid()) return parsed.format('YYYY-MM-DD');
  }
  const shortMatch = raw.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (shortMatch) {
    const month = parseInt(shortMatch[1], 10);
    const day = parseInt(shortMatch[2], 10);
    const year = dayjs().year();
    const parsed = dayjs(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    if (parsed.isValid()) {
      if (parsed.isBefore(dayjs(), 'day')) {
        return parsed.add(1, 'year').format('YYYY-MM-DD');
      }
      return parsed.format('YYYY-MM-DD');
    }
  }
  return null;
}

async function handleAdminCommand(client, event, command, text = '') {
  const replyToken = event.replyToken;

  switch (command) {
    case 'list': {
      const projects = queries.getAllActiveProjects();
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: templates.projectListMessage(projects),
        }],
      });
    }

    case 'editors': {
      const editors = queries.getAllEditors();
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: templates.editorListMessage(editors),
        }],
      });
    }

    case 'clients': {
      const clients = queries.getAllClients();
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: templates.clientListMessage(clients),
        }],
      });
    }

    case 'delete_project': {
      // 「案件削除 案件名/編集者名」または「案件削除 案件名/編集者名/発注者名」形式
      const match = text.match(/^案件削除[\s　]+(.+?)[\s　]*\/[\s　]*(.+?)(?:[\s　]*\/[\s　]*(.+))?$/);
      if (!match) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '⚠️ 案件名と編集者名を指定してください。\n\n案件削除 案件名/編集者名\n（重複がある場合）案件削除 案件名/編集者名/発注者名\n\n例: 案件削除 Claude Code解説＿ねねさん/高須賀綾',
          }],
        });
      }

      const projectTitle = match[1].trim();
      const editorName = match[2].trim();
      const clientName = match[3] ? match[3].trim() : null;

      // 発注者指定なしで複数件ヒットする場合は、絞り込みを要求
      if (!clientName) {
        const count = queries.countProjectsByTitleAndEditor(projectTitle, editorName);
        if (count > 1) {
          return client.replyMessage({
            replyToken,
            messages: [{
              type: 'text',
              text: `⚠️ 「${projectTitle}」（編集者: ${editorName}）の案件が${count}件あります。\n発注者名も指定して再実行してください。\n\n案件削除 案件名/編集者名/発注者名`,
            }],
          });
        }
      }

      const deleted = queries.deleteProjectByTitleAndEditor(projectTitle, editorName, clientName);

      if (!deleted) {
        const target = clientName ? `（編集者: ${editorName} / 発注者: ${clientName}）` : `（編集者: ${editorName}）`;
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `⚠️ 案件「${projectTitle}」${target}が見つかりません。\n\n※ 完了済みの案件は削除できません。\n※ 案件名・編集者名・発注者名が正確か確認してください。`,
          }],
        });
      }

      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `🗑️ 案件を削除しました。\n─────────────\n案件名: ${deleted.title}\n編集者: ${deleted.editor_name}\n発注者: ${deleted.client_name || 'なし'}\n─────────────`,
        }],
      });
    }

    case 'delete_editor': {
      // 「編集者削除 名前」形式
      const match = text.match(/^編集者削除[\s　]+(.+)$/);
      if (!match) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '⚠️ 編集者名を指定してください。\n\n編集者削除 名前\n\n例: 編集者削除 高須賀綾',
          }],
        });
      }

      const name = match[1].trim();

      // 未完了案件があるか確認
      const activeProjects = queries.getProjectsByEditorName(name);
      if (activeProjects.length > 0) {
        const list = activeProjects.map(p => `・${p.title}`).join('\n');
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `⚠️ 「${name}」には未完了の案件があるため削除できません。\n\n${list}\n\n先に案件削除してください。`,
          }],
        });
      }

      const deleted = queries.deactivateEditorByName(name);
      if (!deleted) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `⚠️ 編集者「${name}」が見つかりません。`,
          }],
        });
      }

      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `🗑️ 編集者「${name}」を削除しました。\n（LINE連携も解除されました）`,
        }],
      });
    }

    case 'update_project': {
      // 「案件更新 案件名/編集者/発注者/着手日/納期(/備考)」形式
      const body = text.replace(/^案件更新[\s　/]+/, '').replace(/\/+$/, '');
      const normalized = body.replace(/／/g, '/').replace(/[\s　]*\/[\s　]*/g, '/');

      const dYMD = '\\d{4}-\\d{1,2}-\\d{1,2}';
      const dYSD = '\\d{4}\\/\\d{1,2}\\/\\d{1,2}';
      const dSD = '\\d{1,2}\\/\\d{1,2}';
      const dHD = '\\d{1,2}-\\d{1,2}';
      const datePattern = `(?:${dYMD}|${dYSD}|${dSD}|${dHD})`;
      const regex = new RegExp(`^(.+?)\\/(.*?)\\/(.+?)\\/(${datePattern})\\/(${datePattern})(?:\\/(.+))?$`);
      const m = normalized.match(regex);

      if (!m) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '⚠️ 入力形式が正しくありません。\n\n案件更新 案件名/編集者/発注者/着手日/納期\n（備考を変更する場合）案件更新 案件名/編集者/発注者/着手日/納期/備考\n\n例: 案件更新 安さにうんざり/川口美由紀/村上幸太朗/2026-04-20/2026-04-23',
          }],
        });
      }

      const title = m[1].trim();
      const editorName = m[2].trim();
      const clientName = m[3].trim();
      const startDateRaw = m[4].trim();
      const deadlineRaw = m[5].trim();
      const note = m[6] ? m[6].trim() : null;

      const startDate = parseDate(startDateRaw);
      const deadline = parseDate(deadlineRaw);
      if (!startDate || !deadline) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '⚠️ 着手日または納期の形式が不正です。\n\n対応形式: 2026-04-20 / 2026/04/20 / 4-20 / 4/20',
          }],
        });
      }

      const existing = queries.getActiveProjectByTitleAndEditor(title, editorName);
      if (!existing) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `⚠️ 案件「${title}」（編集者: ${editorName}）が見つかりません。\n\n※ 完了済みの案件は更新できません。\n※ 新規登録の場合は「案件登録」を使ってください。`,
          }],
        });
      }

      // 発注者の取得 or 自動登録
      let clientRecord = queries.getClientByName(clientName);
      if (!clientRecord) {
        queries.createClient(clientName);
        clientRecord = queries.getClientByName(clientName);
      }

      queries.updateProjectFields(existing.id, {
        clientId: clientRecord.id,
        startDate,
        deadline,
        note,
      });

      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `🔄 案件を更新しました。\n─────────────\n案件名: ${title}\n編集者: ${editorName}\n発注者: ${clientName}\n着手日: ${startDate}\n納期: ${deadline}\n備考: ${note || 'なし'}\n─────────────`,
        }],
      });
    }

    case 'rename_project': {
      // 「案件名変更 旧案件名/編集者/新案件名」形式
      const match = text.match(/^案件名変更[\s　]+(.+?)[\s　]*\/[\s　]*(.+?)[\s　]*\/[\s　]*(.+)$/);
      if (!match) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '⚠️ 入力形式が正しくありません。\n\n案件名変更 旧案件名/編集者/新案件名\n\n例: 案件名変更 安さにうんざり/川口美由紀/安さにうんざり（続編）',
          }],
        });
      }
      const oldTitle = match[1].trim();
      const editorName = match[2].trim();
      const newTitle = match[3].trim();

      const existing = queries.getActiveProjectByTitleAndEditor(oldTitle, editorName);
      if (!existing) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `⚠️ 案件「${oldTitle}」（編集者: ${editorName}）が見つかりません。`,
          }],
        });
      }

      // 同じ編集者に同名の別案件が既にあれば拒否
      const conflict = queries.getActiveProjectByTitleAndEditor(newTitle, editorName);
      if (conflict && conflict.id !== existing.id) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `⚠️ 「${newTitle}」（編集者: ${editorName}）は既に別案件として登録されています。`,
          }],
        });
      }

      queries.updateProjectTitle(existing.id, newTitle);
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `🔄 案件名を変更しました。\n─────────────\n旧: ${oldTitle}\n新: ${newTitle}\n編集者: ${editorName}\n─────────────`,
        }],
      });
    }

    case 'reassign_editor': {
      // 「担当者変更 案件名/旧編集者/新編集者」形式
      const match = text.match(/^担当者変更[\s　]+(.+?)[\s　]*\/[\s　]*(.+?)[\s　]*\/[\s　]*(.+)$/);
      if (!match) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '⚠️ 入力形式が正しくありません。\n\n担当者変更 案件名/旧編集者/新編集者\n\n例: 担当者変更 安さにうんざり/川口美由紀/高須賀綾',
          }],
        });
      }
      const title = match[1].trim();
      const oldEditorName = match[2].trim();
      const newEditorName = match[3].trim();

      const existing = queries.getActiveProjectByTitleAndEditor(title, oldEditorName);
      if (!existing) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `⚠️ 案件「${title}」（編集者: ${oldEditorName}）が見つかりません。`,
          }],
        });
      }

      const newEditor = queries.getEditorByName(newEditorName);
      if (!newEditor) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `⚠️ 新しい編集者「${newEditorName}」が未登録です。\n最初に「編集者連携 ${newEditorName}」を実行してください。`,
          }],
        });
      }

      // 新担当者に同名案件が既にあれば拒否
      const conflict = queries.getActiveProjectByTitleAndEditor(title, newEditorName);
      if (conflict && conflict.id !== existing.id) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `⚠️ 「${title}」は既に「${newEditorName}」の案件として登録されています。`,
          }],
        });
      }

      queries.updateProjectEditor(existing.id, newEditor.id);
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `🔄 担当編集者を変更しました。\n─────────────\n案件名: ${title}\n旧: ${oldEditorName}\n新: ${newEditorName}\n─────────────`,
        }],
      });
    }

    case 'delete_client': {
      // 「発注者削除 名前」形式
      const match = text.match(/^発注者削除[\s　]+(.+)$/);
      if (!match) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '⚠️ 発注者名を指定してください。\n\n発注者削除 名前\n\n例: 発注者削除 山田',
          }],
        });
      }

      const name = match[1].trim();

      // 未完了案件があるか確認
      const targetClient = queries.getClientByName(name);
      if (targetClient) {
        const activeProjects = queries.getProjectsByClientId(targetClient.id);
        if (activeProjects.length > 0) {
          const list = activeProjects.map(p => `・${p.title}`).join('\n');
          return client.replyMessage({
            replyToken,
            messages: [{
              type: 'text',
              text: `⚠️ 「${name}」には未完了の案件があるため削除できません。\n\n${list}\n\n先に案件削除してください。`,
            }],
          });
        }
      }

      const deleted = queries.deactivateClientByName(name);
      if (!deleted) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `⚠️ 発注者「${name}」が見つかりません。`,
          }],
        });
      }

      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `🗑️ 発注者「${name}」を削除しました。\n（LINE連携も解除されました）`,
        }],
      });
    }

    case 'register_editor': {
      // 「編集者登録 名前」形式
      const match = text.match(/^編集者登録\s+(.+)$/);
      if (!match) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '編集者名を指定してください。\n例: 編集者登録 田中',
          }],
        });
      }

      const name = match[1].trim();
      const existing = queries.getEditorByName(name);
      if (existing) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `「${name}」は既に登録されています。`,
          }],
        });
      }

      queries.createEditor(name);
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `✅ 編集者「${name}」を登録しました。\n\n編集者本人がBotに「LINE連携 ${name}」と送信すると、LINEアカウントと紐付けられます。`,
        }],
      });
    }

    default:
      return null;
  }
}

module.exports = { handleAdminCommand };
