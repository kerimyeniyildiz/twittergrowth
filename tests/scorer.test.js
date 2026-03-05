import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Scoring cascade decision table tests.
 * These test the decision logic without making actual API calls.
 */

function cascadeDecision(score5mini, scoreFlash = null, scorePro = null, opts = {}) {
    const { autoSend = false, nightOrTrend = false, trend = false } = opts;

    // Step 1: GPT-5 Mini threshold
    if (score5mini < 70) {
        return { action: 'drop', label: 'dropped' };
    }
    if (score5mini < 85) {
        return { action: 'suggest', label: 'normal' };
    }

    // Step 2: Need Gemini Flash (score5mini >= 85)
    if (scoreFlash === null) {
        return { action: 'suggest', label: 'normal' }; // flash error fallback
    }

    let label;
    if (scoreFlash < 80) label = 'şüpheli';
    else if (scoreFlash < 88) label = 'iyi aday';
    else label = 'çok iyi';

    const autoSendCandidate = scoreFlash >= 90 && score5mini >= 92;
    if (autoSendCandidate) label = 'auto-send adayı';

    // Step 3: Pro check
    if (autoSendCandidate && autoSend && nightOrTrend && score5mini >= 92 && scoreFlash >= 88) {
        if (scorePro !== null) {
            if (scorePro >= 90) return { action: 'auto-send', label: 'auto-send' };
        }
    }

    return { action: 'suggest', label };
}

describe('Scoring Cascade Decision Table', () => {
    // — Step 1: GPT-5 Mini —

    it('score_5mini < 70 → DROP', () => {
        const r = cascadeDecision(50);
        assert.equal(r.action, 'drop');
        assert.equal(r.label, 'dropped');
    });

    it('score_5mini = 69 → DROP', () => {
        const r = cascadeDecision(69);
        assert.equal(r.action, 'drop');
    });

    it('score_5mini = 70 → normal (suggest)', () => {
        const r = cascadeDecision(70);
        assert.equal(r.action, 'suggest');
        assert.equal(r.label, 'normal');
    });

    it('score_5mini = 84 → normal (suggest)', () => {
        const r = cascadeDecision(84);
        assert.equal(r.action, 'suggest');
        assert.equal(r.label, 'normal');
    });

    // — Step 2: Gemini Flash —

    it('5mini=90, flash=75 → şüpheli', () => {
        const r = cascadeDecision(90, 75);
        assert.equal(r.label, 'şüpheli');
        assert.equal(r.action, 'suggest');
    });

    it('5mini=90, flash=83 → iyi aday', () => {
        const r = cascadeDecision(90, 83);
        assert.equal(r.label, 'iyi aday');
    });

    it('5mini=90, flash=88 → çok iyi', () => {
        const r = cascadeDecision(90, 88);
        assert.equal(r.label, 'çok iyi');
    });

    it('5mini=92, flash=91 → auto-send adayı', () => {
        const r = cascadeDecision(92, 91);
        assert.equal(r.label, 'auto-send adayı');
    });

    it('5mini=91, flash=91 → çok iyi (not auto-send because 5mini < 92)', () => {
        const r = cascadeDecision(91, 91);
        assert.equal(r.label, 'çok iyi');
    });

    // — Step 3: Pro check —

    it('auto-send candidate with pro >= 90 → AUTO TWEET', () => {
        const r = cascadeDecision(95, 92, 93, { autoSend: true, nightOrTrend: true });
        assert.equal(r.action, 'auto-send');
    });

    it('auto-send candidate with pro < 90 → suggest (needs approval)', () => {
        const r = cascadeDecision(95, 92, 85, { autoSend: true, nightOrTrend: true });
        assert.equal(r.action, 'suggest');
    });

    it('auto-send candidate but auto disabled → suggest', () => {
        const r = cascadeDecision(95, 92, 95, { autoSend: false, nightOrTrend: true });
        assert.equal(r.action, 'suggest');
    });

    it('auto-send candidate but not in night/trend → suggest', () => {
        const r = cascadeDecision(95, 92, 95, { autoSend: true, nightOrTrend: false });
        assert.equal(r.action, 'suggest');
    });

    // — Flash error fallback —

    it('flash returns null → fallback to normal', () => {
        const r = cascadeDecision(90, null);
        assert.equal(r.label, 'normal');
        assert.equal(r.action, 'suggest');
    });
});
