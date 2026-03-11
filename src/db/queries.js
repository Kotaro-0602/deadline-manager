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
    WHERE p.editor_id = ? AND p.status != 'completed'
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
           julianday('now', 'localtime') - julianday(p.deadline) as days_overdue
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
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
    SELECT p.*, e.name as editor_name, e.line_user_id as editor_line_id
    FROM projects p
    LEFT JOIN editors e ON p.editor_id = e.id
    WHERE p.deadline > date('now', 'localtime')
    AND p.status NOT IN ('completed')
    ORDER BY p.deadline ASC
  `).all();
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
  getProjectByTitleAndEditorLineId,
  getProjectByTitlePartial,
  updateProjectStatus,
  getCompletedProjectsThisWeek,
  createReminderLog,
  getTodayReminderLog,
  getOverdueProjects,
  getTodayDeadlineProjects,
  getUpcomingProjects,
  getProjectsDueSoon,
};
