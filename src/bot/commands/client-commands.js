const dayjs = require('dayjs');
const queries = require('../../db/queries');

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
  const revMatch = status.match(/^revision_(\d+)$/);
  if (revMatch) return `修正${revMatch[1]}提出済`;
  return status;
}

async function handleClientCommand(client, event, command, text = '') {
  const userId = event.source.userId;
  const replyToken = event.replyToken;

  switch (command) {
    // 発注者LINE連携（自動登録対応）
    case 'link': {
      const match = text.match(/^発注者連携[  ](.+)$/);
      if (!match) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '名前を指定してください。例: 発注者連携 山田',
          }],
        });
      }
      const name = match[1].trim();
      let clientRecord = queries.getClientByName(name);

      // 未登録の場合は自動登録してLINE連携
      if (!clientRecord) {
        queries.createClient(name);
        clientRecord = queries.getClientByName(name);
        queries.updateClientLineId(clientRecord.id, userId);
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `✅ ${name}さんを発注者として登録し、LINE連携が完了しました！\n「案件確認」で発注した案件の進捗を確認できます。`,
          }],
        });
      }

      if (clientRecord.line_user_id) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: `「${name}」は既にLINE連携済みです。`,
          }],
        });
      }

      queries.updateClientLineId(clientRecord.id, userId);
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `✅ ${name}さんのLINE連携が完了しました！\n「案件確認」で発注した案件の進捗を確認できます。`,
        }],
      });
    }

    // 発注者の案件確認
    case 'check': {
      const clientRecord = queries.getClientByLineId(userId);
      if (!clientRecord) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '発注者として登録されていません。\n「発注者連携 名前」でLINE連携してください。',
          }],
        });
      }

      const projects = queries.getProjectsByClientId(clientRecord.id);
      if (projects.length === 0) {
        return client.replyMessage({
          replyToken,
          messages: [{
            type: 'text',
            text: '現在、進行中の案件はありません。',
          }],
        });
      }

      let msg = `📋 ${clientRecord.name}さんの発注案件\n━━━━━━━━━━━━━━━━\n\n`;

      for (const p of projects) {
        const daysLeft = Math.floor(p.days_remaining);
        const deadline = dayjs(p.deadline);
        const deadlineStr = deadline.format('M/D');
        const status = statusLabel(p.status);

        let statusIcon;
        let daysInfo;

        if (daysLeft < 0) {
          // 遅延
          statusIcon = '🔴';
          daysInfo = `${Math.abs(daysLeft)}日超過`;
        } else if (daysLeft === 0) {
          // 本日納期
          statusIcon = '🟡';
          daysInfo = '本日納期';
        } else if (daysLeft <= 3) {
          // 3日以内
          statusIcon = '🟠';
          daysInfo = `あと${daysLeft}日`;
        } else {
          statusIcon = '🟢';
          daysInfo = `あと${daysLeft}日`;
        }

        msg += `${statusIcon} #${String(p.id).padStart(3, '0')} ${p.title}\n`;
        msg += `　編集者: ${p.editor_name}\n`;
        msg += `　納期: ${deadlineStr}（${daysInfo}）\n`;
        msg += `　状態: ${status}\n\n`;
      }

      return client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: msg.trim() }],
      });
    }

    default:
      return null;
  }
}

module.exports = { handleClientCommand };
