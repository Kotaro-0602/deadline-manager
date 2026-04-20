/**
 * ユーザー×グループ単位の一時確認セッションを保持（インメモリ）。
 * 再起動で消えてOKな短命データのみ扱う。
 * TTLは5分。期限切れは取得時に自動削除。
 */
const sessions = new Map();
const TTL_MS = 5 * 60 * 1000;

function sessionKey(userId, groupId) {
  return `${userId}:${groupId || 'dm'}`;
}

function setSession(userId, groupId, data) {
  const key = sessionKey(userId, groupId);
  sessions.set(key, { ...data, expiresAt: Date.now() + TTL_MS });
}

function getSession(userId, groupId) {
  const key = sessionKey(userId, groupId);
  const s = sessions.get(key);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(key);
    return null;
  }
  return s;
}

function clearSession(userId, groupId) {
  sessions.delete(sessionKey(userId, groupId));
}

module.exports = { setSession, getSession, clearSession };
