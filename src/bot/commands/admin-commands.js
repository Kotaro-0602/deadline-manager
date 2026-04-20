const queries = require('../../db/queries');
const templates = require('../templates');

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
      // 「案件削除 案件名/編集者名」形式
      const match = text.match(/^案件削除[\s　]+(.+?)[\s　]*\/[\s　]*(.+)$/);
      if (!match) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '⚠️ 案件名と編集者名を指定してください。\n\n案件削除 案件名/編集者名\n\n例: 案件削除 Claude Code解説＿ねねさん/高須賀綾',
          }],
        });
      }

      const projectTitle = match[1].trim();
      const editorName = match[2].trim();
      const deleted = queries.deleteProjectByTitleAndEditor(projectTitle, editorName);

      if (!deleted) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `⚠️ 案件「${projectTitle}」（編集者: ${editorName}）が見つかりません。\n\n※ 完了済みの案件は削除できません。\n※ 案件名・編集者名が正確か確認してください。`,
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
