const { getDb } = require('./init');

// === 編集者 ===

function createEditor(name, lineUserId = null) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO editors (name, line_user_id) VALUES (?, ?)'
  );
  return stmt.run(name, lineUserId);
}

function getEditorByLineId(lineUserId) {
  const db = getDb();
  return db.prepare('SELECT * FROM editors WHERE line_user_id = ?').get(lineUserId);
}

function getEditorById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM editors WHERE id = ?').get(id);
}

function getEditorByName(name) {
  const db = getDb();
  return db.prepare('SELECT * FROM editors WHERE name = ?').get(name);
}

function getAllEditors() {
  const db = getDb();
  return db.prepare("SELECT * FROM editors WHERE status = 'active' ORDER BY name").all();
}

function updateEditorLineId(editorId, lineUserId) {
  const db = getDb();
  return db.prepare('UPDATE editors SET line_user_id = ? WHERE id = ?').run(lineUserId, editorId);
}

// === 発注者 ===

function createClient(name, lineUserId = null) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO clients (name, line_user_id) VALUES (?, ?)'
  );
  return stmt.run(name, lineUserId);
}

function getClientByName(name) {
  const db = getDb();
  return db.prepare('SELECT * FROM clients WHERE name = ?').get(name);
}

function getClientByLineId(lineUserId) {
  const db = getDb();
  return db.prepare('SELECT * FROM clients WHERE line_user_id = ?').get(lineUserId);
}

function getAllClients() {
  const db = getDb();
  return db.prepare("SELECT * FROM clients WHERE status = 'active' ORDER BY name").all();
}

function updateClientLineId(clientId, lineUserId) {
  const db = getDb();
  return db.prepare('UPDATE clients SET line_user_id = ? WHERE id = ?').run(lineUserId, clientId);
}

function getProjectsByClientLineId(lineUserId) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, c.name as client_name,
           julianday(p.deadline) - julianday('now', 'localtime') as days_remaining
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE c.line_user_id = ? AND p.status != 'completed'
    ORDER BY p.deadline ASC
  `).all(lineUserId);
}

function getProjectsByClientId(clientId) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, c.name as client_name,
           julianday(p.deadline) - julianday('now', 'localtime') as days_remaining
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.client_id = ? AND p.status != 'completed'
    ORDER BY p.deadline ASC
  `).all(clientId);
}

// === 案件 ===

function createProject(title, editorId, registeredBy, deadline, note = null, clientId = null, startDate = null) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO projects (title, editor_id, client_id, registered_by, deadline, note, start_date) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  return stmt.run(title, editorId, clientId, registeredBy, deadline, note, startDate);
}

function getProjectById(id) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id,
           c.name as client_name, c.line_user_id as client_line_id
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.id = ?
  `).get(id);
}

function getProjectsByEditorId(editorId) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    WHERE p.editor_id = ? AND p.status = 'completed'
    ORDER BY p.deadline ASC
  `).all(editorId);
}

function getProjectsByEditorLineId(lineUserId) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    WHERE e.line_user_id = ? AND p.status != 'completed'
    ORDER BY p.deadline ASC
  `).all(lineUserId);
}

function getAllActiveProjects() {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id,
           c.name as client_name
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.status != 'completed'
    ORDER BY p.deadline ASC
  `).all();
}

function getAllProjects() {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, c.name as client_name
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    ORDER BY p.deadline ASC
  `).all();
}

function getProjectsByEditorName(editorName) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    WHERE e.name = ? AND p.status != 'completed'
    ORDER BY p.deadline ASC
  `).all(editorName);
}

function getProjectByTitle(title) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id,
           c.name as client_name, c.line_user_id as client_line_id
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.title = ? AND p.status != 'completed'
  `).get(title);
}

function getProjectByTitlePartialAny(title) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id,
           c.name as client_name, c.line_user_id as client_line_id
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.title LIKE ? AND p.status != 'completed'
  `).get('%' + title + '%');
}

/**
 * 表記ゆれを考慮したファジー案件検索
 * 「vs」⇔「対」、大文字⇔小文字、全角⇔半角数字 等を正規化してマッチ
 */
function getProjectByTitleFuzzy(searchTitle) {
  const db = getDb();
  const projects = db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id,
           c.name as client_name, c.line_user_id as client_line_id
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.status != 'completed'
  `).all();

  const normalize = (str) => str
    .toLowerCase()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/対/g, 'vs')
    .replace(/[\s　_＿\-－]/g, '')
    .trim();

  const normalizedSearch = normalize(searchTitle);

  // 完全一致 → 部分一致 の順に検索
  for (const p of projects) {
    if (normalize(p.title) === normalizedSearch) return p;
  }
  for (const p of projects) {
    if (normalize(p.title).includes(normalizedSearch) || normalizedSearch.includes(normalize(p.title))) return p;
  }
  return null;
}

/**
 * 編集者のLINE IDから未完了案件を取得（1件のみ担当中なら自動特定用）
 */
function getActiveProjectsByEditorLineId(lineUserId) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id,
           c.name as client_name, c.line_user_id as client_line_id
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE e.line_user_id = ? AND p.status NOT IN ('completed', 'unstarted')
    ORDER BY p.deadline ASC
  `).all(lineUserId);
}

function getProjectByTitleAndEditorLineId(title, lineUserId) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id,
           c.name as client_name, c.line_user_id as client_line_id
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.title = ? AND e.line_user_id = ? AND p.status != 'completed'
  `).get(title, lineUserId);
}

function getProjectByTitlePartial(title, lineUserId) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id,
           c.name as client_name, c.line_user_id as client_line_id
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.title LIKE ? AND e.line_user_id = ? AND p.status != 'completed'
  `).get('%' + title + '%', lineUserId);
}

function updateProjectStatus(projectId, status) {
  const db = getDb();
  return db.prepare(
    "UPDATE projects SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
  ).run(status, projectId);
}

/**
 * 提出日時を記録する
 * @param {number} projectId
 * @param {string} status - first_draft, revision_1, revision_2, revision_3, completed
 */
function recordSubmissionTimestamp(projectId, status) {
  const db = getDb();
  const columnMap = {
    'first_draft': 'first_draft_at',
    'revision_1': 'revision_1_at',
    'revision_2': 'revision_2_at',
    'revision_3': 'revision_3_at',
    'completed': 'completed_at',
  };
  const column = columnMap[status];
  if (!column) return; // 対応するカラムがなければスキップ

  return db.prepare(
    `UPDATE projects SET ${column} = datetime('now', 'localtime') WHERE id = ?`
  ).run(projectId);
}

function getCompletedProjectsThisWeek() {
  const db = getDb();
  return db.prepare(`
    SELECT COUNT(*) as count FROM projects
    WHERE status = 'completed'
    AND updated_at >= date('now', 'localtime', 'weekday 0', '-7 days')
  `).get();
}

// === リマインドログ ===

function createReminderLog(projectId, type) {
  const db = getDb();
  return db.prepare(
    'INSERT INTO reminder_logs (project_id, type) VALUES (?, ?)'
  ).run(projectId, type);
}

function getTodayReminderLog(projectId, type) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM reminder_logs
    WHERE project_id = ? AND type = ?
    AND date(sent_at) = date('now', 'localtime')
  `).get(projectId, type);
}

// === ダッシュボード用 ===

function getOverdueProjects() {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id,
           c.name as client_name,
           julianday('now', 'localtime') - julianday(p.deadline) as days_overdue
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.deadline < date('now', 'localtime')
    AND p.status NOT IN ('completed', 'submitted')
    ORDER BY p.deadline ASC
  `).all();
}

function getTodayDeadlineProjects() {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    WHERE p.deadline = date('now', 'localtime')
    AND p.status NOT IN ('completed', 'submitted')
    ORDER BY e.name ASC
  `).all();
}

function getUpcomingProjects() {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id,
           c.name as client_name
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.deadline > date('now', 'localtime')
    AND p.status NOT IN ('completed')
    ORDER BY p.deadline ASC
  `).all();
}

/**
 * 着手日が今日以前で、まだ未着手の案件を取得（自動着手用）
 */
function getProjectsToAutoStart() {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    WHERE p.start_date IS NOT NULL
    AND p.start_date <= date('now', 'localtime')
    AND p.status = 'unstarted'
  `).all();
}

/**
 * 編集者未アサイン（editor_id IS NULL）で登録から指定日数以上経過した未完了案件を取得
 */
function getUnassignedProjects(daysOld = 2) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, c.name as client_name, c.line_user_id as client_line_id
    FROM projects p
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.editor_id IS NULL
    AND p.status != 'completed'
    AND julianday('now', 'localtime') - julianday(p.created_at) >= ?
    ORDER BY p.deadline ASC
  `).all(daysOld);
}

/**
 * 案件名＋編集者名で未完了案件を特定して削除
 * @returns {object|null} 削除した案件情報、見つからなければnull
 */
function deleteProjectByTitleAndEditor(title, editorName) {
  const db = getDb();
  const project = db.prepare(`
    SELECT p.*, e.name as editor_name, c.name as client_name
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    LEFT JOIN clients c ON p.client_id = c.id
    WHERE p.title = ? AND e.name = ? AND p.status != 'completed'
  `).get(title, editorName);
  if (!project) return null;
  db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  return project;
}

/**
 * 編集者を名前で削除（statusをinactiveに変更）
 * @returns {object|null} 削除した編集者情報、見つからなければnull
 */
function deactivateEditorByName(name) {
  const db = getDb();
  const editor = db.prepare('SELECT * FROM editors WHERE name = ? AND status = ?').get(name, 'active');
  if (!editor) return null;
  db.prepare("UPDATE editors SET status = 'inactive', line_user_id = NULL WHERE id = ?").run(editor.id);
  return editor;
}

function getProjectsDueSoon(daysAhead) {
  const db = getDb();
  return db.prepare(`
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    WHERE p.deadline = date('now', 'localtime', '+' || ? || ' days')
    AND p.status NOT IN ('completed', 'submitted')
  `).all(daysAhead);
}

module.exports = {
  createEditor,
  getEditorByLineId,
  getEditorById,
  getEditorByName,
  getAllEditors,
  updateEditorLineId,
  createClient,
  getClientByName,
  getClientByLineId,
  getAllClients,
  updateClientLineId,
  getProjectsByClientLineId,
  getProjectsByClientId,
  createProject,
  getProjectById,
  getProjectsByEditorId,
  getProjectsByEditorLineId,
  getAllActiveProjects,
  getAllProjects,
  getProjectsByEditorName,
  getProjectByTitle,
  getProjectByTitlePartialAny,
  getProjectByTitleFuzzy,
  getActiveProjectsByEditorLineId,
  getProjectByTitleAndEditorLineId,
  getProjectByTitlePartial,
  updateProjectStatus,
  recordSubmissionTimestamp,
  getCompletedProjectsThisWeek,
  createReminderLog,
  getTodayReminderLog,
  getOverdueProjects,
  getTodayDeadlineProjects,
  getUpcomingProjects,
  getUnassignedProjects,
  getProjectsToAutoStart,
  getProjectsDueSoon,
  deleteProjectByTitleAndEditor,
  deactivateEditorByName,
  getEditorDeliveryStats,
};

function getEditorDeliveryStats(editorId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN date(completed_at) <= date(deadline) THEN 1 ELSE 0 END) as on_time
    FROM projects
    WHERE editor_id = ? AND status = 'completed' AND completed_at IS NOT NULL
  `).get(editorId);
  const onTime = row.on_time || 0;
  const late = (row.total || 0) - onTime;
  return { onTime, late };
}
