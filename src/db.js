import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

let db;

export function initDB() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(path.join(DATA_DIR, 'tweetgrowth.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate();
    return db;
}

export function getDB() {
    if (!db) throw new Error('DB not initialized. Call initDB() first.');
    return db;
}

function migrate() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      username      TEXT PRIMARY KEY,
      poll_interval INTEGER NOT NULL DEFAULT 300,
      active        INTEGER NOT NULL DEFAULT 1,
      last_cursor   TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id          TEXT UNIQUE NOT NULL,
      account           TEXT NOT NULL,
      text              TEXT NOT NULL,
      normalized_text   TEXT,
      fingerprint       TEXT,
      media_urls        TEXT,
      status            TEXT NOT NULL DEFAULT 'new'
        CHECK(status IN ('new','scored','suggested','rewritten','sent','skipped','dropped')),
      trend             INTEGER NOT NULL DEFAULT 0,
      similar_count_10m INTEGER NOT NULL DEFAULT 0,
      score_5mini       INTEGER,
      score_flash       INTEGER,
      score_pro         INTEGER,
      score_reason      TEXT,
      label             TEXT,
      rewritten_text    TEXT,
      telegram_msg_id   INTEGER,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS seen_fingerprints (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL,
      tweet_id    TEXT NOT NULL,
      account     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_seen_fp ON seen_fingerprints(fingerprint, created_at);
    CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);
    CREATE INDEX IF NOT EXISTS idx_candidates_tweet_id ON candidates(tweet_id);

    CREATE TABLE IF NOT EXISTS sent_posts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id  INTEGER NOT NULL REFERENCES candidates(id),
      tweet_url     TEXT,
      error         TEXT,
      tweeted_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ——— Accounts ———

export function getAccounts() {
    return getDB().prepare('SELECT * FROM accounts ORDER BY username').all();
}

export function getActiveAccounts() {
    return getDB().prepare('SELECT * FROM accounts WHERE active = 1').all();
}

export function getAccount(username) {
    return getDB().prepare('SELECT * FROM accounts WHERE username = ?').get(username);
}

export function addAccount(username, pollInterval = 300) {
    return getDB().prepare(
        'INSERT OR IGNORE INTO accounts (username, poll_interval) VALUES (?, ?)'
    ).run(username, pollInterval);
}

export function removeAccount(username) {
    return getDB().prepare('DELETE FROM accounts WHERE username = ?').run(username);
}

export function updateAccountInterval(username, interval) {
    return getDB().prepare('UPDATE accounts SET poll_interval = ? WHERE username = ?').run(interval, username);
}

export function pauseAccount(username) {
    return getDB().prepare('UPDATE accounts SET active = 0 WHERE username = ?').run(username);
}

export function resumeAccount(username) {
    return getDB().prepare('UPDATE accounts SET active = 1 WHERE username = ?').run(username);
}

export function updateCursor(username, cursor) {
    return getDB().prepare('UPDATE accounts SET last_cursor = ? WHERE username = ?').run(cursor, username);
}

// ——— Candidates ———

export function insertCandidate({ tweet_id, account, text, normalized_text, fingerprint, media_urls }) {
    return getDB().prepare(`
    INSERT OR IGNORE INTO candidates (tweet_id, account, text, normalized_text, fingerprint, media_urls)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tweet_id, account, text, normalized_text, fingerprint, media_urls ? JSON.stringify(media_urls) : null);
}

export function candidateExists(tweetId) {
    return !!getDB().prepare('SELECT 1 FROM candidates WHERE tweet_id = ?').get(tweetId);
}

export function getCandidate(id) {
    return getDB().prepare('SELECT * FROM candidates WHERE id = ?').get(id);
}

export function getCandidateByTweetId(tweetId) {
    return getDB().prepare('SELECT * FROM candidates WHERE tweet_id = ?').get(tweetId);
}

export function updateCandidate(id, fields) {
    const keys = Object.keys(fields);
    const sets = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => fields[k]);
    return getDB().prepare(`UPDATE candidates SET ${sets} WHERE id = ?`).run(...vals, id);
}

// ——— Seen Fingerprints ———

export function recordFingerprint(fingerprint, tweetId, account) {
    return getDB().prepare(
        'INSERT INTO seen_fingerprints (fingerprint, tweet_id, account) VALUES (?, ?, ?)'
    ).run(fingerprint, tweetId, account);
}

export function findSimilarFingerprints(fingerprint, hoursBack = 6) {
    return getDB().prepare(`
    SELECT * FROM seen_fingerprints
    WHERE fingerprint = ? AND created_at >= datetime('now', ?)
  `).all(fingerprint, `-${hoursBack} hours`);
}

export function countTrendFingerprints(fingerprint, minutesBack = 10) {
    const row = getDB().prepare(`
    SELECT COUNT(DISTINCT account) as cnt FROM seen_fingerprints
    WHERE fingerprint = ? AND created_at >= datetime('now', ?)
  `).get(fingerprint, `-${minutesBack} minutes`);
    return row?.cnt || 0;
}

export function getSimilarAccounts(fingerprint) {
    return getDB().prepare(`
    SELECT DISTINCT account FROM seen_fingerprints WHERE fingerprint = ?
  `).all(fingerprint).map(r => r.account);
}

// ——— Sent Posts ———

export function recordSent(candidateId, tweetUrl, error = null) {
    return getDB().prepare(
        'INSERT INTO sent_posts (candidate_id, tweet_url, error) VALUES (?, ?, ?)'
    ).run(candidateId, tweetUrl, error);
}

// ——— Stats ———

export function getTodayStats() {
    const d = getDB();
    const today = "datetime('now', 'start of day')";
    return {
        collected: d.prepare(`SELECT COUNT(*) as c FROM candidates WHERE created_at >= ${today}`).get().c,
        dropped: d.prepare(`SELECT COUNT(*) as c FROM candidates WHERE status = 'dropped' AND created_at >= ${today}`).get().c,
        suggested: d.prepare(`SELECT COUNT(*) as c FROM candidates WHERE status IN ('suggested','rewritten') AND created_at >= ${today}`).get().c,
        sent: d.prepare(`SELECT COUNT(*) as c FROM sent_posts WHERE tweeted_at >= ${today}`).get().c,
        skipped: d.prepare(`SELECT COUNT(*) as c FROM candidates WHERE status = 'skipped' AND created_at >= ${today}`).get().c,
    };
}

// ——— Seed ———

export function seedAccounts(usernames, defaultInterval = 300) {
    const stmt = getDB().prepare('INSERT OR IGNORE INTO accounts (username, poll_interval) VALUES (?, ?)');
    const tx = getDB().transaction((list) => {
        for (const u of list) stmt.run(u, defaultInterval);
    });
    tx(usernames);
}
