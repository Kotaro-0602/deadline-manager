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
