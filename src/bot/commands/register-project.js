const dayjs = require('dayjs');
const queries = require('../../db/queries');
const templates = require('../templates');

/**
 * 一括入力形式で案件登録
 * フォーマット: 案件登録 案件名/編集者名/発注者名/納期
 *              案件登録 案件名/編集者名/発注者名/納期/備考
 *
 * 納期は YYYY-MM-DD, YYYY/MM/DD, M/D 等に対応
 * 編集者・発注者は未登録なら自動登録
 */
async function handleRegisterProject(client, event, text) {
  const userId = event.source.userId;
  const replyToken = event.replyToken;

  // 「案件登録」だけの場合は使い方を表示
  if (text === '案件登録') {
    return client.replyMessage({
      replyToken,
      messages: [{
        type: 'text',
        text: '📝 案件登録フォーマット\n━━━━━━━━━━━━━━━━\n\n案件登録 案件名/編集者/発注者/着手日/納期\n\n例:\n案件登録 AI産業革命/安藤弘隆/山田太郎/2026-03-10/2026-03-20\n案件登録 CM動画編集/田中/鈴木/3-10/3-20\n\n※編集者が未定の場合:\n案件登録 案件名/未定/発注者/着手日/納期\n（「未定」「-」「なし」または空欄で登録可）\n\n※備考を追加する場合:\n案件登録 案件名/編集者/発注者/着手日/納期/備考\n\n※日付は 2026-03-13 や 3-20 形式で入力',
      }],
    });
  }

  // 「案件登録 」または「案件登録/」以降を取り出してパース
  const body = text.replace(/^案件登録[\s　/]+/, '').replace(/\/+$/, '');
  const parsed = parseRegistration(body);

  if (!parsed) {
    return client.replyMessage({
      replyToken,
      messages: [{
        type: 'text',
        text: '⚠️ 入力形式が正しくありません。\n\n案件登録 案件名/編集者/発注者/着手日/納期\n\n例: 案件登録 AI産業革命/安藤弘隆/山田太郎/2026-03-10/2026-03-20',
      }],
    });
  }

  const { title, editorName, clientName, startDate, deadline, note } = parsed;

  // --- 編集者が「未定」かどうか判定 ---
  const isEditorUnassigned = !editorName || ['未定', '-', 'なし', ''].includes(editorName.trim());

  // --- 着手日バリデーション ---
  const parsedStartDate = parseDeadline(startDate);
  if (!parsedStartDate) {
    return client.replyMessage({
      replyToken,
      messages: [{
        type: 'text',
        text: `⚠️ 着手日「${startDate}」を認識できません。\n\n以下の形式で入力してください:\n・2026-03-13\n・2026/03/13\n・3-13 または 3/13（今年と判定）`,
      }],
    });
  }

  // --- 納期バリデーション ---
  const parsedDeadline = parseDeadline(deadline);
  if (!parsedDeadline) {
    return client.replyMessage({
      replyToken,
      messages: [{
        type: 'text',
        text: `⚠️ 納期「${deadline}」を認識できません。\n\n以下の形式で入力してください:\n・2026-03-13\n・2026/03/13\n・3-13 または 3/13（今年と判定）`,
      }],
    });
  }

  // --- 編集者の取得 or 自動登録（未定の場合はスキップ） ---
  let editor = null;
  if (!isEditorUnassigned) {
    editor = queries.getEditorByName(editorName);
    if (!editor) {
      return client.replyMessage({
        replyToken,
        messages: [{
          type: 'text',
          text: `⚠️ 編集者「${editorName}」の編集者連携が行われていません。\n\n編集者連携が行われていない状態では案件登録ができません。\n最初に編集者連携を行ってください。\n\n【編集者連携方法】\n編集者連携 ${editorName}`,
        }],
      });
    }
  }

  // --- 発注者の取得 or 自動登録 ---
  let clientRecord = queries.getClientByName(clientName);
  if (!clientRecord) {
    queries.createClient(clientName);
    clientRecord = queries.getClientByName(clientName);
  }

  // --- DB登録 ---
  const result = queries.createProject(
    title,
    editor ? editor.id : null,
    userId,
    parsedDeadline,
    note || null,
    clientRecord.id,
    parsedStartDate
  );

  const project = {
    id: result.lastInsertRowid,
    title,
    startDate: parsedStartDate,
    deadline: parsedDeadline,
    note: note || null,
  };

  const displayEditorName = isEditorUnassigned ? '未定（募集中）' : editorName;

  // 登録者への返信
  await client.replyMessage({
    replyToken,
    messages: [
      { type: 'text', text: templates.projectRegisteredMessage(project, displayEditorName, clientName) },
    ],
  });

  // DM通知は不要（グループ内の返信で完結）

  return;
}

/**
 * 登録テキストをパースする
 * 「/」区切りだが、日付内の「/」と区別するため正規表現で解析
 *
 * フォーマット: 案件名/編集者/発注者/着手日/納期(/備考)
 *
 * 日付パターン: YYYY-MM-DD, YYYY/MM/DD, M/D, M-D
 */
function parseRegistration(body) {
  // 入力の正規化: 全角スラッシュ→半角、/ 前後のスペースを除去
  const normalized = body
    .replace(/／/g, '/')
    .replace(/[\s　]*\/[\s　]*/g, '/');

  // 日付パターンの部品
  const dYMD  = '\\d{4}-\\d{1,2}-\\d{1,2}';   // YYYY-MM-DD
  const dYSD  = '\\d{4}\\/\\d{1,2}\\/\\d{1,2}'; // YYYY/MM/DD
  const dSD   = '\\d{1,2}\\/\\d{1,2}';          // M/D
  const dHD   = '\\d{1,2}-\\d{1,2}';            // M-D
  const datePattern = `(?:${dYMD}|${dYSD}|${dSD}|${dHD})`;

  // 案件名/編集者/発注者/着手日/納期(/備考)  ※編集者は空欄・未定・-・なし も許容
  const regex = new RegExp(
    `^(.+?)\\/(.*?)\\/(.+?)\\/(${datePattern})\\/(${datePattern})(?:\\/(.+))?$`
  );

  const m = normalized.match(regex);
  if (m) {
    return {
      title: m[1].trim(),
      editorName: m[2].trim(),  // 空文字の場合もある
      clientName: m[3].trim(),
      startDate: m[4].trim(),
      deadline: m[5].trim(),
      note: m[6] ? m[6].trim() : null,
    };
  }

  return null;
}

/**
 * 柔軟な日付パース
 * 対応形式: YYYY-MM-DD, YYYY/MM/DD, MM/DD, M/D, MM-DD, M-D
 */
function parseDeadline(raw) {
  // YYYY-MM-DD or YYYY/MM/DD
  const normalized = raw.replace(/\//g, '-');
  if (normalized.match(/^\d{4}-\d{1,2}-\d{1,2}$/)) {
    const parsed = dayjs(normalized);
    if (parsed.isValid()) return parsed.format('YYYY-MM-DD');
  }

  // MM/DD or M/D（今年として扱う）
  const shortMatch = raw.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (shortMatch) {
    const month = parseInt(shortMatch[1], 10);
    const day = parseInt(shortMatch[2], 10);
    const year = dayjs().year();
    const parsed = dayjs(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    if (parsed.isValid()) {
      // 過去の日付なら来年にする
      if (parsed.isBefore(dayjs(), 'day')) {
        return parsed.add(1, 'year').format('YYYY-MM-DD');
      }
      return parsed.format('YYYY-MM-DD');
    }
  }

  return null;
}

// isInSession は不要になったが後方互換のため残す
function isInSession() {
  return false;
}

module.exports = { handleRegisterProject, isInSession };
