import { collectAccount } from './collector.js';
import { processDedup } from './dedup.js';
import { scoringCascade } from './scorer.js';
import { sendTweet } from './sender.js';
import { notifyCandidate, notifyAdmin, setAccountChangeCallback } from './bot.js';
import { getActiveAccounts, getCandidate, updateCandidate, getAccount } from './db.js';
import { safeJsonParse } from './utils.js';

const timers = new Map(); // username -> intervalId

/**
 * Run the full pipeline for one account:
 *   collect → dedup → score → decide → notify/auto-send
 */
async function runForAccount(username) {
    try {
        const acc = getAccount(username);
        if (!acc || !acc.active) return;

        // 1. Collect
        const newCandidates = await collectAccount(username);
        if (newCandidates.length === 0) return;

        for (const raw of newCandidates) {
            const latestAcc = getAccount(username);
            if (!latestAcc || !latestAcc.active) {
                console.log(`[Pipeline] @${username} paused, stopping current run`);
                break;
            }

            const candidate = getCandidate(raw.id);
            if (!candidate) continue;

            // 2. Dedup
            const dedup = processDedup(candidate);
            if (dedup.action === 'DROP') {
                updateCandidate(candidate.id, { status: 'dropped' });
                console.log(`[Pipeline] #${candidate.id} DROP (${dedup.reason})`);
                continue;
            }

            // Update trend info
            updateCandidate(candidate.id, {
                trend: dedup.trend ? 1 : 0,
                similar_count_10m: dedup.similarCount,
            });

            // Refresh candidate after updates
            const refreshed = getCandidate(candidate.id);

            // 3. Scoring cascade
            const result = await scoringCascade(refreshed);
            console.log(`[Pipeline] #${candidate.id} → ${result.label} (action: ${result.action})`);

            if (result.action === 'drop') {
                continue; // Already marked as dropped in scorer
            }

            if (result.action === 'auto-send') {
                // Auto-send: tweet immediately
                const final = getCandidate(candidate.id);
                const mediaUrls = final.media_urls ? safeJsonParse(final.media_urls) : null;
                const sendResult = await sendTweet(final.text, mediaUrls, final.id);

                if (sendResult.success) {
                    await notifyAdmin(
                        `⚡ <b>AUTO-SEND</b> #${final.id}\n` +
                        `@${final.account}\n` +
                        `Skorlar: 5mini=${result.scores.score_5mini} flash=${result.scores.score_flash} pro=${result.scores.score_pro}\n` +
                        `${sendResult.tweetUrl}`
                    );
                } else {
                    await notifyAdmin(`❌ AUTO-SEND başarısız #${final.id}: ${sendResult.error}`);
                }
                continue;
            }

            // Suggest to admin via Telegram
            const final = getCandidate(candidate.id);
            await notifyCandidate(final);
        }
    } catch (err) {
        console.error(`[Pipeline] Error for @${username}:`, err.message);
    }
}

/**
 * Start polling for a single account.
 */
function startAccountTimer(username, intervalSec) {
    if (timers.has(username)) {
        clearInterval(timers.get(username));
    }

    // Run immediately, then on interval
    runForAccount(username);

    const id = setInterval(() => runForAccount(username), intervalSec * 1000);
    timers.set(username, id);
    console.log(`[Pipeline] Started timer for @${username} (every ${intervalSec}s)`);
}

/**
 * Stop polling for a single account.
 */
function stopAccountTimer(username) {
    if (timers.has(username)) {
        clearInterval(timers.get(username));
        timers.delete(username);
        console.log(`[Pipeline] Stopped timer for @${username}`);
    }
}

/**
 * Handle account changes from Telegram commands.
 */
function handleAccountChange(action, username, interval) {
    switch (action) {
        case 'add':
            startAccountTimer(username, interval || 300);
            break;
        case 'remove':
        case 'pause':
            stopAccountTimer(username);
            break;
        case 'resume':
            startAccountTimer(username, interval || 300);
            break;
        case 'interval':
            stopAccountTimer(username);
            startAccountTimer(username, interval);
            break;
    }
}

/**
 * Start the pipeline for all active accounts.
 */
export function startPipeline() {
    setAccountChangeCallback(handleAccountChange);

    const accounts = getActiveAccounts();
    console.log(`[Pipeline] Starting pipeline for ${accounts.length} active account(s)`);

    for (const acc of accounts) {
        startAccountTimer(acc.username, acc.poll_interval);
    }
}

/**
 * Stop all timers.
 */
export function stopPipeline() {
    for (const [username] of timers) {
        stopAccountTimer(username);
    }
}
