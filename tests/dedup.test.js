import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, fingerprint, isNightWindow, truncate } from '../src/utils.js';

describe('normalize()', () => {
    it('lowercases text', () => {
        assert.equal(normalize('HELLO WORLD'), 'hello world');
    });

    it('removes URLs', () => {
        assert.equal(normalize('Check this https://t.co/abc123 out'), 'check this out');
    });

    it('removes @mentions', () => {
        assert.equal(normalize('@elonmusk said hello'), 'said hello');
    });

    it('removes hashtag symbols but keeps word', () => {
        assert.equal(normalize('#breaking news'), 'breaking news');
    });

    it('collapses repeated punctuation', () => {
        assert.equal(normalize('wow!!!! really???'), 'wow! really?');
    });

    it('collapses whitespace', () => {
        assert.equal(normalize('hello   world   test'), 'hello world test');
    });

    it('handles Turkish characters', () => {
        const input = 'Türkiye Çok Güzel Ülke';
        const result = normalize(input);
        assert.equal(result, 'türkiye çok güzel ülke');
    });

    it('handles complex mixed input', () => {
        const input = '@user1 Breaking: Earthquake hits Turkey!! https://t.co/xyz #deprem @user2';
        const result = normalize(input);
        assert.equal(result, 'breaking: earthquake hits turkey! deprem');
    });
});

describe('fingerprint()', () => {
    it('returns null for empty/short text', () => {
        assert.equal(fingerprint(''), null);
        assert.equal(fingerprint('hi'), null);
        assert.equal(fingerprint(null), null);
    });

    it('returns consistent hash for same input', () => {
        const text = 'this is a test tweet about something important';
        const fp1 = fingerprint(text);
        const fp2 = fingerprint(text);
        assert.equal(fp1, fp2);
    });

    it('returns different hash for different input', () => {
        const fp1 = fingerprint('this is about politics in turkey');
        const fp2 = fingerprint('this is about sports in turkey');
        assert.notEqual(fp1, fp2);
    });

    it('returns 32-char hex string', () => {
        const fp = fingerprint('a longer text that is valid for fingerprinting');
        assert.match(fp, /^[a-f0-9]{32}$/);
    });
});

describe('isNightWindow()', () => {
    it('handles same-day window', () => {
        // We can't easily test time-dependent functions without mocking,
        // but we can test the logic structure by checking it returns a boolean
        const result = isNightWindow('00:00', '23:59', 'Europe/Istanbul');
        assert.equal(typeof result, 'boolean');
    });

    it('handles cross-midnight window', () => {
        const result = isNightWindow('23:00', '08:00', 'Europe/Istanbul');
        assert.equal(typeof result, 'boolean');
    });
});

describe('truncate()', () => {
    it('returns text unchanged if under limit', () => {
        assert.equal(truncate('hello', 280), 'hello');
    });

    it('truncates with ellipsis', () => {
        const long = 'a'.repeat(300);
        const result = truncate(long, 280);
        assert.equal(result.length, 280);
        assert.ok(result.endsWith('...'));
    });

    it('handles null/empty', () => {
        assert.equal(truncate(null), '');
        assert.equal(truncate(''), '');
    });
});
