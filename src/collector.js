import axios from 'axios';
import config from './config.js';
import { getAccount, updateCursor, insertCandidate, candidateExists } from './db.js';

const API_BASE = 'https://twitter-api45.p.rapidapi.com';

/**
 * Fetch user's timeline tweets via RapidAPI.
 * Returns array of raw tweet objects.
 */
async function fetchUserTweets(username, cursor = null) {
    try {
        const params = { screenname: username };
        if (cursor) params.cursor = cursor;

        const response = await axios.get(`${API_BASE}/timeline.php`, {
            params,
            headers: {
                'x-rapidapi-key': config.rapidapi.key,
                'x-rapidapi-host': config.rapidapi.host,
            },
            timeout: 15000,
        });

        return response.data;
    } catch (err) {
        console.error(`[Collector] Error fetching @${username}:`, err.message);
        return null;
    }
}

/**
 * Filter tweet: skip replies and retweets by default.
 */
function shouldInclude(tweet, includeReplies = false, includeRetweets = false) {
    if (!tweet) return false;
    // Skip replies
    if (!includeReplies && tweet.in_reply_to_user_id) return false;
    // Skip retweets
    if (!includeRetweets && (tweet.retweeted_tweet || tweet.text?.startsWith('RT @'))) return false;
    return true;
}

/**
 * Extract media URLs from a tweet.
 */
function extractMedia(tweet) {
    const media = [];
    if (tweet.media) {
        if (tweet.media.photo) {
            for (const p of tweet.media.photo) {
                if (p.media_url_https) media.push(p.media_url_https);
            }
        }
        if (tweet.media.video) {
            for (const v of tweet.media.video) {
                // Get highest quality variant
                const variants = v.variants?.filter(vr => vr.content_type === 'video/mp4') || [];
                variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                if (variants[0]) media.push(variants[0].url);
            }
        }
    }
    return media.length > 0 ? media : null;
}

/**
 * Collect new tweets for a given account.
 * Returns array of newly inserted candidate objects.
 */
export async function collectAccount(username) {
    const account = getAccount(username);
    if (!account) {
        console.warn(`[Collector] Account @${username} not found in DB`);
        return [];
    }

    console.log(`[Collector] Fetching @${username}...`);
    const data = await fetchUserTweets(username, account.last_cursor);
    if (!data || !data.timeline) {
        console.warn(`[Collector] No data for @${username}`);
        return [];
    }

    const tweets = (data.timeline || []).slice(0, config.maxTweetsPerPoll);
    const newCandidates = [];

    for (const tweet of tweets) {
        // Skip if already processed
        const tweetId = tweet.tweet_id || tweet.rest_id;
        if (!tweetId) continue;
        if (candidateExists(tweetId)) continue;

        // Skip replies/retweets
        if (!shouldInclude(tweet)) continue;

        const text = tweet.text || tweet.full_text || '';
        if (!text || text.length < 10) continue;

        const mediaUrls = extractMedia(tweet);

        const result = insertCandidate({
            tweet_id: tweetId,
            account: username,
            text,
            normalized_text: null, // Will be set during dedup
            fingerprint: null,     // Will be set during dedup
            media_urls: mediaUrls,
        });

        if (result.changes > 0) {
            newCandidates.push({
                id: result.lastInsertRowid,
                tweet_id: tweetId,
                account: username,
                text,
                media_urls: mediaUrls,
            });
        }
    }

    // Update cursor for next poll
    if (data.cursor_endpoint || data.next_cursor) {
        updateCursor(username, data.cursor_endpoint || data.next_cursor);
    }

    console.log(`[Collector] @${username}: ${newCandidates.length} new tweet(s)`);
    return newCandidates;
}
