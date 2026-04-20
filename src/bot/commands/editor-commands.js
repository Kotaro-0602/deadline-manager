const queries = require('../../db/queries');
const templates = require('../templates');

async function handleEditorCommand(client, event, command, text = '') {
  const userId = event.source.userId;
  const replyToken = event.replyToken;

  switch (command) {
    case 'link': {
      const match = text.match(/^(?:LINE連携|編集者連携)[\s　]+(.+)$/);
      if (!match) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '名前を指定してください。\n例: 編集者連携 田中',
          }],
        });
      }
      const name = match[1].trim();
      let editor = queries.getEditorByName(name);

      // 未登録の場合は自動登録してLINE連携
      if (!editor) {
        queries.createEditor(name);
        editor = queries.getEditorByName(name);
        queries.updateEditorLineId(editor.id, userId);
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `✅ ${name}さんを編集者として登録し、LINE連携が完了しました！\n「マイ案件」で割り振られた案件を確認できます。`,
          }],
        });
      }

      if (editor.line_user_id) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `「${name}」は既にLINE連携済みです。`,
          }],
        });
      }
      queries.updateEditorLineId(editor.id, userId);
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `✅ ${name}さんのLINE連携が完了しました！\n「マイ案件」で割り振られた案件を確認できます。`,
        }],
      });
    }

    case 'my_projects': {
      const projects = queries.getProjectsByEditorLineId(userId);
      if (projects.length === 0) {
        // LINE連携されていないか、案件がない
        const editor = queries.getEditorByLineId(userId);
        if (!editor) {
          return client.replyMessage({
            replyToken,
            messages: [{
              type: 'text',
              text: 'あなたのLINEアカウントは編集者として登録されていません。管理者に連絡してください。',
            }],
          });
        }
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '現在、割り振られている案件はありません。',
          }],
        });
      }

      const editorName = projects[0].editor_name;
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: templates.editorProjectListMessage(editorName, projects),
        }],
      });
    }

    case 'start': {
      const input = extractInput(text, '着手');
      if (!input) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '案件名を指定してください。\n例: 着手 AI産業革命',
          }],
        });
      }

      const project = findProject(input, userId);
      if (!project) {
        return client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: `「${input}」に該当する案件が見つかりません。` }],
        });
      }

      if (project.editor_line_id !== userId) {
        return client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: 'この案件の担当者ではありません。' }],
        });
      }

      queries.updateProjectStatus(project.id, 'in_progress');
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `✅ ${project.title} を「作業中」に変更しました。`,
        }],
      });
    }

    case 'submit': {
      const input = extractInput(text, '提出');
      if (!input) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '案件名を指定してください。\n例: 提出 AI産業革命',
          }],
        });
      }

      const project = findProject(input, userId);
      if (!project) {
        return client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: `「${input}」に該当する案件が見つかりません。` }],
        });
      }

      if (project.editor_line_id !== userId) {
        return client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: 'この案件の担当者ではありません。' }],
        });
      }

      queries.updateProjectStatus(project.id, 'submitted');
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `✅ ${project.title} を「提出済」に変更しました。`,
        }],
      });
    }

    default:
      return null;
  }
}

// 「着手 ○○」「提出 ○○」からコマンド後の入力を取り出す
function extractInput(text, prefix) {
  const match = text.match(new RegExp(`^${prefix}[\\s　]+(.+)$`));
  if (match) return match[1].trim();
  return null;
}

// 番号 or 案件名で案件を検索
function findProject(input, userId) {
  // まず番号として試す
  const num = parseInt(input, 10);
  if (!isNaN(num) && String(num) === input) {
    return queries.getProjectById(num);
  }

  // 案件名で完全一致検索
  let project = queries.getProjectByTitleAndEditorLineId(input, userId);
  if (project) return project;

  // 案件名で部分一致検索
  project = queries.getProjectByTitlePartial(input, userId);
  return project || null;
}

module.exports = { handleEditorCommand };
