const { handleRegisterProject } = require('./commands/register-project');
const { handleDashboard } = require('./commands/dashboard');
const { handleEditorCommand } = require('./commands/editor-commands');
const { handleClientCommand } = require('./commands/client-commands');
const { handleAdminCommand } = require('./commands/admin-commands');
const { helpMessage, withMention, withInlineMention } = require('./templates');
const { syncAllData, isEnabled: isSheetsEnabled } = require('../sheets/sync');
const { triggerBackup } = require('../db/backup');
const queries = require('../db/queries');

// データ変更後にスプレッドシートを非同期で同期 + バックアップ
function triggerSync() {
  if (isSheetsEnabled()) {
    setTimeout(() => syncAllData(), 1000);
    triggerBackup();
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
  const groupId = event.source.groupId || event.source.roomId || null;
  const replyToken = event.replyToken;

  if (groupId) {
    console.log(`[GROUP] Message from group/room: ${groupId}`);
  }

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
    const result = await handleAdminCommand(client, event, 'register_editor', text);
    triggerSync();
    return result;
  }

  if (text === '案件削除' || text.startsWith('案件削除 ') || text.startsWith('案件削除　')) {
    const result = await handleAdminCommand(client, event, 'delete_project', text);
    triggerSync();
    return result;
  }

  if (text === '編集者削除' || text.startsWith('編集者削除 ') || text.startsWith('編集者削除　')) {
    const result = await handleAdminCommand(client, event, 'delete_editor', text);
    triggerSync();
    return result;
  }

  // 編集者LINE連携
  if (text.startsWith('LINE連携 ') || text.startsWith('LINE連携　') ||
      text.startsWith('編集者連携 ') || text.startsWith('編集者連携　')) {
    const result = await handleEditorCommand(client, event, 'link', text);
    triggerSync();
    return result;
  }

  // 発注者LINE連携
  if (text.startsWith('発注者連携 ') || text.startsWith('発注者連携　')) {
    const result = await handleClientCommand(client, event, 'link', text);
    triggerSync();
    return result;
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
 * #初稿 / #修正N / #納品 + #案件名 を検出して自動ステータス更新
 * 例: "#初稿 #ストリート転職"  → 初稿提出済
 *     "#修正1 #Claude code"  → 修正1提出済
 *     "#納品 #2022vs2026"    → 完了
 *     "#納品"（案件名なし）   → 担当案件が1件なら自動特定
 *
 * 表記ゆれ対応: "vs"⇔"対"、全角⇔半角、大文字⇔小文字
 */
async function handleHashtagStatus(client, event, rawText) {
  const replyToken = event.replyToken;
  const userId = event.source.userId;

  // ハッシュタグを全て抽出（# と ＃ 両方対応）
  // スペースを含む案件名に対応: #タグ1 の後、次の # または行末までをタグ値とする
  // 例: "#納品 #Claude Code解説__ねねさん" → ['納品', 'Claude Code解説__ねねさん']
  const tagNames = [];
  const tagRegex = /[#＃]([^#＃@＠]+)/g;
  let match;
  while ((match = tagRegex.exec(rawText)) !== null) {
    const value = match[1].trim();
    if (value) tagNames.push(value);
  }
  if (tagNames.length === 0) return null;

  // ステータスタグを検出（#初稿 or #修正N or #納品）
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
    const revMatch = name.match(/修正\D*(\d+)/);
    if (revMatch) {
      newStatus = `revision_${revMatch[1]}`;
      statusLabel = `修正${revMatch[1]}提出済`;
      break;
    }
  }

  if (!newStatus) return null;

  // ステータスタグ以外を案件名候補として取得
  const projectNames = tagNames.filter(
    name => name !== '初稿' && name !== '納品' && !/修正\D*\d+/.test(name)
  );

  let project = null;

  if (projectNames.length > 0) {
    // 案件名ハッシュタグがある場合:
    // まず送信者（編集者）の担当案件内で検索し、見つからなければ全案件から検索
    for (const name of projectNames) {
      // 1) 送信者の担当案件で完全一致 → 部分一致
      project = queries.getProjectByTitleAndEditorLineId(name, userId);
      if (project) break;
      project = queries.getProjectByTitlePartial(name, userId);
      if (project) break;
    }
    if (!project) {
      // 2) 全案件から 完全一致 → 部分一致 → ファジーマッチ
      for (const name of projectNames) {
        project = queries.getProjectByTitle(name);
        if (project) break;
        project = queries.getProjectByTitlePartialAny(name);
        if (project) break;
        project = queries.getProjectByTitleFuzzy(name);
        if (project) break;
      }
    }
  } else {
    // 案件名ハッシュタグがない場合（#初稿 や #納品 だけ）:
    // 送信者の担当する進行中案件から自動特定を試みる
    const activeProjects = queries.getActiveProjectsByEditorLineId(userId);
    if (activeProjects.length === 1) {
      // 担当案件が1件のみなら自動特定
      project = activeProjects[0];
      console.log(`[HASHTAG] Auto-detected project: "${project.title}" (only active project for editor)`);
    } else if (activeProjects.length > 1) {
      // 複数案件担当中 → 案件名を指定するようメッセージ
      const projectList = activeProjects.map(p => `・${p.title}`).join('\n');
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `⚠️ 担当案件が複数あるため、案件名のハッシュタグも付けてください。\n\n例: #${tagNames[0]} #案件名\n\n📋 あなたの担当案件:\n${projectList}`,
        }],
      });
    }
  }

  if (!project) {
    // ステータスタグはあるが案件が特定できない場合、エラーメッセージを返す
    let errorText = '⚠️ 提出方法に誤りがあります。\n━━━━━━━━━━━━━━━━\n';
    if (projectNames.length === 0) {
      errorText += '【原因】案件名のハッシュタグがありません。\n\n';
      errorText += '【正しい形式】\n';
      errorText += `#${tagNames[0]} #案件名\n\n`;
      errorText += '例: #初稿 #Tier表\n';
      errorText += '例: #修正1 #Claude Code解説\n';
      errorText += '例: #納品 #2022vs2026\n\n';
      errorText += 'ハッシュタグ案件名も追加で記載して再提出をお願いします。';
    } else {
      errorText += `【原因】案件「${projectNames.join('、')}」が登録されていません。\n\n`;
      errorText += '案件登録がまだの場合は、最初に案件登録を行ってください。\n';
      errorText += '案件名が間違っている場合は、正しい案件名で再提出をお願いします。';
    }
    return client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: errorText }],
    });
  }

  // ステータス更新 + 提出日時を記録
  queries.updateProjectStatus(project.id, newStatus);
  queries.recordSubmissionTimestamp(project.id, newStatus);

  // グループ返信（DM不要、グループ内メンションで通知）
  if (newStatus === 'completed') {
    // 納品完了時はリッチなメッセージ + 発注者メンション
    let replyText = `🎉 案件「${project.title}」が納品されました。\n編集者: ${project.editor_name}\n\nお疲れ様でした！`;
    if (project.client_line_id) {
      replyText += `\n\n📦 {mention}さん、納品物のご確認・お受け取りをお願いいたします。`;
      const msg = withInlineMention(replyText, project.client_name || '発注者', project.client_line_id);
      return client.replyMessage({
        replyToken,
        messages: [msg],
      });
    }
    return client.replyMessage({
      replyToken,
      messages: [{ type: 'text', text: replyText }],
    });
  }

  // 初稿・修正提出時 → 発注者メンション付きでグループに返信
  if (project.client_line_id) {
    const replyText = `✅ ${project.title} を「${statusLabel}」に更新しました。\n\n{mention}さん、確認をお願いします。`;
    const msg = withInlineMention(replyText, project.client_name || '発注者', project.client_line_id);
    return client.replyMessage({
      replyToken,
      messages: [msg],
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
