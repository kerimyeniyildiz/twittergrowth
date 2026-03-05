import { candidateExists, findSimilarFingerprints, countTrendFingerprints, recordFingerprint, updateCandidate } from './db.js';
import { normalize, fingerprint } from './utils.js';

/**
 * Process dedup for a candidate object (from DB).
 * Returns { action: 'DROP' | 'PASS', reason?: string, trend: boolean, similarCount: number }
 */
export function processDedup(candidate) {
    const tweetId = candidate.tweet_id;

    // 1. Normalize & fingerprint
    const normText = normalize(candidate.text);
    const fp = fingerprint(normText);

    // Save normalized text + fingerprint to candidate
    updateCandidate(candidate.id, { normalized_text: normText, fingerprint: fp });

    if (!fp) {
        return { action: 'PASS', reason: 'too-short-for-fp', trend: false, similarCount: 0 };
    }

    // 2. Check similar fingerprint in last 6 hours
    const similar = findSimilarFingerprints(fp, 6);
    const alreadySeen = similar.length > 0;

    // 3. Record this fingerprint
    recordFingerprint(fp, tweetId, candidate.account);

    // 4. Trend detection: 3+ distinct accounts with same fp in 10 min
    const trendCount = countTrendFingerprints(fp, 10);
    const isTrend = trendCount >= 3;

    if (alreadySeen && !isTrend) {
        // Similar content exists and it's not trending → DROP
        return { action: 'DROP', reason: 'similar-exists', trend: false, similarCount: trendCount };
    }

    // If similar exists but trending, we still pass (trend overrides dedup for first seen per account)
    return {
        action: 'PASS',
        reason: alreadySeen ? 'similar-but-trending' : 'unique',
        trend: isTrend,
        similarCount: trendCount,
    };
}
