import { TwitterApi } from 'twitter-api-v2';
import axios from 'axios';
import config from './config.js';
import { updateCandidate, recordSent } from './db.js';

let client;

function getClient() {
    if (!client) {
        client = new TwitterApi({
            appKey: config.x.apiKey,
            appSecret: config.x.apiSecret,
            accessToken: config.x.accessToken,
            accessSecret: config.x.accessSecret,
        });
    }
    return client;
}

/**
 * Download media from URL and return Buffer.
 */
async function downloadMedia(url) {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    return Buffer.from(response.data);
}

/**
 * Upload media to X and return media_id.
 */
async function uploadMedia(buffer, mimeType = 'image/jpeg') {
    const mediaId = await getClient().v1.uploadMedia(buffer, { mimeType });
    return mediaId;
}

/**
 * Send a tweet via X API.
 *
 * @param {string} text - Tweet text
 * @param {string[]} [mediaUrls] - Optional media URLs to download and attach
 * @param {number} candidateId - Candidate ID for logging
 * @returns {{ success: boolean, tweetUrl?: string, error?: string }}
 */
export async function sendTweet(text, mediaUrls = null, candidateId = null) {
    // Dry-run mode
    if (config.dryRun) {
        console.log(`[Sender] DRY-RUN would tweet: "${text.slice(0, 100)}..."`);
        if (candidateId) {
            updateCandidate(candidateId, { status: 'sent' });
            recordSent(candidateId, 'DRY-RUN', null);
        }
        return { success: true, tweetUrl: 'DRY-RUN' };
    }

    try {
        const tweetParams = { text };

        // Upload media if provided
        if (mediaUrls && mediaUrls.length > 0) {
            const mediaIds = [];
            for (const url of mediaUrls.slice(0, 4)) { // X allows max 4 media
                try {
                    const buffer = await downloadMedia(url);
                    const mimeType = url.includes('.mp4') ? 'video/mp4' :
                        url.includes('.gif') ? 'image/gif' :
                            url.includes('.png') ? 'image/png' : 'image/jpeg';
                    const mediaId = await uploadMedia(buffer, mimeType);
                    mediaIds.push(mediaId);
                } catch (mediaErr) {
                    console.error(`[Sender] Media upload failed for ${url}:`, mediaErr.message);
                }
            }
            if (mediaIds.length > 0) {
                tweetParams.media = { media_ids: mediaIds };
            }
        }

        const result = await getClient().v2.tweet(tweetParams);
        const tweetUrl = `https://x.com/i/status/${result.data.id}`;

        console.log(`[Sender] Tweet posted: ${tweetUrl}`);

        if (candidateId) {
            updateCandidate(candidateId, { status: 'sent' });
            recordSent(candidateId, tweetUrl, null);
        }

        return { success: true, tweetUrl };
    } catch (err) {
        console.error('[Sender] Error posting tweet:', err.message);

        if (candidateId) {
            recordSent(candidateId, null, err.message);
        }

        return { success: false, error: err.message };
    }
}
