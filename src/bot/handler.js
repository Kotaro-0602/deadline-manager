const { handleRegisterProject } = require('./commands/register-project');
const { handleDashboard } = require('./commands/dashboard');
const { handleEditorCommand } = require('./commands/editor-commands');
const { handleClientCommand } = require('./commands/client-commands');
const { handleAdminCommand } = require('./commands/admin-commands');
const { helpMessage } = require('./templates');
const { syncAllData, isEnabled: isSheetsEnabled } = require('../sheets/sync');
const queries = require('../db/queries');

// データ変更後にスプレッドシートを非同期で同期
function triggerSync() {
  if (isSheetsEnabled()) {
    setTimeout(() => syncAllData(), 1000);
  }
}

// メンション（@Bot名）を除去してコマンド部分だけ取り出す
function stripMention(text) {
  // LINE のメンションは Unicode で特殊文字が入ることがあるので、@から始まる部分を除去
  return text.replace(/@[^\s　]+[\s　]*/g, '').trim();
}

async function handleMessage(client, event) {
  const rawText = event.message.text.trim();
  const text = stripMention(rawText);
  const userId = event.source.userId;
  const sourceType = event.source.type; // 'user' | 'group' | 'room'
  const replyToken = event.replyToken;

  // コマンドルーティング
  if (text === '案件登録' || text.startsWith('案件登録 ') || text.startsWith('案件登録　') || text.startsWith('案件登録/')) {
    const result = await handleRegisterProject(client, event, text);
    triggerSync();
    return result;
  }

  if (text === '進捗' || text.startsWith('進捗 @') || text.startsWith('進捗 ＠')) {
    return handleDashboard(client, event, text);
  }

  if (text === '案件一覧') {
    return handleAdminCommand(client, event, 'list');
  }

  if (text === '編集者一覧') {
    return handleAdminCommand(client, event, 'editors');
  }

  if (text === '編集者登録' || text.startsWith('編集者登録 ')) {
    return handleAdminCommand(client, event, 'register_editor', text);
  }

  // 編集者LINE連携
  if (text.startsWith('LINE連携 ') || text.startsWith('LINE連携　') ||
      text.startsWith('編集者連携 ') || text.startsWith('編集者連携　')) {
    return handleEditorCommand(client, event, 'link', text);
  }

  // 発注者LINE連携
  if (text.startsWith('発注者連携 ') || text.startsWith('発注者連携　')) {
    return handleClientCommand(client, event, 'link', text);
  }

  // 発注者の案件確認
  if (text === '案件確認') {
    return handleClientCommand(client, event, 'check');
  }

  // 発注者一覧
  if (text === '発注者一覧') {
    return handleAdminCommand(client, event, 'clients');
  }

  // 編集者向けコマンド
  if (text === 'マイ案件') {
    return handleEditorCommand(client, event, 'my_projects');
  }

  if (text.startsWith('着手 ') || text.startsWith('着手')) {
    const result = await handleEditorCommand(client, event, 'start', text);
    triggerSync();
    return result;
  }

  if (text.startsWith('提出 ') || text.startsWith('提出')) {
    const result = await handleEditorCommand(client, event, 'submit', text);
    triggerSync();
    return result;
  }

  if (text === 'ヘルプ' || text === 'help') {
    return client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: helpMessage() }],
    });
  }

  // #初稿 / #修正N 検出 → 自動ステータス更新
  if (/[#＃](初稿|修正\d+|納品)/.test(rawText)) {
    const result = await handleHashtagStatus(client, event, rawText);
    if (result) {
      triggerSync();
      return result;
    }
  }

  // 未知のコマンド
  return null;
}

/**
 * #初稿 / #修正N + #案件名 を検出して自動ステータス更新
 * 例: "#初稿 #ストリート転職"  → 初稿提出済
 *     "#修正1 #Claude code"  → 修正1提出済
 *     "#修正2 #Claude code"  → 修正2提出済
 */
async function handleHashtagStatus(client, event, rawText) {
  const replyToken = event.replyToken;

  // ハッシュタグを全て抽出（# と ＃ 両方対応、スペースなしの連結も対応）
  const hashtags = rawText.match(/[#＃]([^\s#＃@＠]+)/g);
  if (!hashtags || hashtags.length < 2) return null;

  const tagNames = hashtags.map(tag => tag.replace(/^[#＃]/, ''));

  // ステータスタグを検出（#初稿 or #修正N）
  let newStatus = null;
  let statusLabel = null;

  for (const name of tagNames) {
    if (name === '初稿') {
      newStatus = 'first_draft';
      statusLabel = '初稿提出済';
      break;
    }
    if (name === '納品') {
      newStatus = 'completed';
      statusLabel = '完了';
      break;
    }
    const revMatch = name.match(/^修正(\d+)$/);
    if (revMatch) {
      newStatus = `revision_${revMatch[1]}`;
      statusLabel = `修正${revMatch[1]}提出済`;
      break;
    }
  }

  if (!newStatus) return null;

  // ステータスタグ以外を案件名候補として取得
  const projectNames = tagNames.filter(
    name => name !== '初稿' && name !== '納品' && !/^修正\d+$/.test(name)
  );

  if (projectNames.length === 0) return null;

  // 各候補で案件を検索
  let project = null;
  for (const name of projectNames) {
    project = queries.getProjectByTitle(name);
    if (project) break;
    project = queries.getProjectByTitlePartialAny(name);
    if (project) break;
  }

  if (!project) return null;

  // ステータス更新
  queries.updateProjectStatus(project.id, newStatus);

  // 発注者に通知（LINE連携済みの場合）
  if (project.client_line_id) {
    let notifyText;
    if (newStatus === 'completed') {
      notifyText = `🎉 案件「${project.title}」が納品されました。\n編集者: ${project.editor_name}\n\nお疲れ様でした！`;
    } else if (newStatus === 'first_draft') {
      notifyText = `📩 案件「${project.title}」の初稿が提出されました。\n編集者: ${project.editor_name}\n\n確認をお願いします。`;
    } else {
      notifyText = `📩 案件「${project.title}」の${statusLabel.replace('提出済', '')}が提出されました。\n編集者: ${project.editor_name}\n\n確認をお願いします。`;
    }

    try {
      await client.pushMessage({
        to: project.client_line_id,
        messages: [{ type: 'text', text: notifyText }],
      });
    } catch (err) {
      console.error('Failed to notify client:', err.message);
    }
  }

  if (newStatus === 'completed') {
    // 納品完了時はリッチなメッセージ + 発注者メンション
    let replyText = `🎉 案件「${project.title}」が納品されました。\n編集者: ${project.editor_name}\n\nお疲れ様でした！`;
    if (project.client_line_id) {
      replyText += `\n\n📦 発注者の${project.client_name || '発注者'}さん、納品物のご確認・お受け取りをお願いいたします。`;
    }
    return client.replyMessage({
      replyToken,
      messages: [{
        type: 'text',
        text: replyText,
      }],
    });
  }

  return client.replyMessage({
    replyToken,
    messages: [{
      type: 'text',
      text: `✅ ${project.title} を「${statusLabel}」に更新しました。`,
    }],
  });
}

module.exports = { handleMessage };
