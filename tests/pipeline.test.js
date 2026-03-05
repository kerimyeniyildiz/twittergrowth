import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { normalize, fingerprint } from '../src/utils.js';

/**
 * Pipeline integration tests using in-memory SQLite.
 */

function createTestDB() {
    const db = new Database(':memory:');
    db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id          TEXT UNIQUE NOT NULL,
      account           TEXT NOT NULL,
      text              TEXT NOT NULL,
      normalized_text   TEXT,
      fingerprint       TEXT,
      media_urls        TEXT,
      status            TEXT NOT NULL DEFAULT 'new',
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
  `);
    return db;
}

describe('Pipeline Integration', () => {
    let db;

    beforeEach(() => {
        db = createTestDB();
    });

    afterEach(() => {
        db.close();
    });

    it('inserts candidate and prevents duplicate tweet_id', () => {
        const stmt = db.prepare(
            'INSERT INTO candidates (tweet_id, account, text) VALUES (?, ?, ?)'
        );
        stmt.run('12345', 'testaccount', 'Hello world');

        // Second insert with same tweet_id should fail
        assert.throws(() => {
            stmt.run('12345', 'testaccount', 'Hello world');
        });
    });

    it('dedup flow: normalize → fingerprint → check', () => {
        const text1 = '@user1 Breaking: Big earthquake hits Turkey!! https://t.co/xyz';
        const text2 = '@user2 Breaking: Big earthquake hits Turkey!! https://t.co/abc';

        const norm1 = normalize(text1);
        const norm2 = normalize(text2);

        // After normalizing, these should be identical
        assert.equal(norm1, norm2);

        const fp1 = fingerprint(norm1);
        const fp2 = fingerprint(norm2);

        assert.equal(fp1, fp2);
    });

    it('fingerprint records track multiple accounts', () => {
        const fp = 'abc123';
        const stmt = db.prepare(
            'INSERT INTO seen_fingerprints (fingerprint, tweet_id, account) VALUES (?, ?, ?)'
        );
        stmt.run(fp, 't1', 'account1');
        stmt.run(fp, 't2', 'account2');
        stmt.run(fp, 't3', 'account3');

        const count = db.prepare(
            'SELECT COUNT(DISTINCT account) as cnt FROM seen_fingerprints WHERE fingerprint = ?'
        ).get(fp);

        assert.equal(count.cnt, 3);
    });

    it('candidate status transitions', () => {
        db.prepare(
            'INSERT INTO candidates (tweet_id, account, text) VALUES (?, ?, ?)'
        ).run('t1', 'acc', 'test');

        const c = db.prepare('SELECT * FROM candidates WHERE tweet_id = ?').get('t1');
        assert.equal(c.status, 'new');

        db.prepare('UPDATE candidates SET status = ? WHERE id = ?').run('scored', c.id);
        const scored = db.prepare('SELECT * FROM candidates WHERE id = ?').get(c.id);
        assert.equal(scored.status, 'scored');

        db.prepare('UPDATE candidates SET status = ? WHERE id = ?').run('suggested', c.id);
        db.prepare('UPDATE candidates SET status = ? WHERE id = ?').run('sent', c.id);

        const sent = db.prepare('SELECT * FROM candidates WHERE id = ?').get(c.id);
        assert.equal(sent.status, 'sent');
    });

    it('similar fingerprint detection across accounts', () => {
        const text = 'son dakika: istanbul\'da fırtına uyarısı yapıldı';
        const norm = normalize(text);
        const fp = fingerprint(norm);

        const stmt = db.prepare(
            'INSERT INTO seen_fingerprints (fingerprint, tweet_id, account) VALUES (?, ?, ?)'
        );

        // 3+ accounts = trend
        stmt.run(fp, 't1', 'account1');
        stmt.run(fp, 't2', 'account2');
        stmt.run(fp, 't3', 'account3');
        stmt.run(fp, 't4', 'account4');

        const trendCount = db.prepare(
            'SELECT COUNT(DISTINCT account) as cnt FROM seen_fingerprints WHERE fingerprint = ?'
        ).get(fp);

        assert.ok(trendCount.cnt >= 3, 'Should detect trend with 3+ accounts');
    });
});
