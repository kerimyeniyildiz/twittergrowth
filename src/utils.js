import crypto from 'crypto';
import config from './config.js';

/**
 * Normalize tweet text for fingerprinting.
 * - lowercase
 * - strip URLs
 * - strip @mentions
 * - simplify punctuation (collapse repeated, strip some)
 * - collapse whitespace
 */
export function normalize(text) {
    let t = text.toLowerCase();
    // Remove URLs
    t = t.replace(/https?:\/\/\S+/gi, '');
    // Remove t.co links
    t = t.replace(/t\.co\/\S+/gi, '');
    // Remove @mentions
    t = t.replace(/@\w+/g, '');
    // Remove hashtag symbols but keep word
    t = t.replace(/#(\w+)/g, '$1');
    // Simplify punctuation: collapse repeated
    t = t.replace(/([!?.,;:])\1+/g, '$1');
    // Remove remaining special chars except basic punctuation
    t = t.replace(/[^\w\sçğıöşüâîûêÇĞİÖŞÜ.,!?;:]/g, '');
    // Collapse whitespace
    t = t.replace(/\s+/g, ' ').trim();
    return t;
}

/**
 * Generate fingerprint from normalized text.
 * Uses MD5 of first 120 chars for speed.
 */
export function fingerprint(normalizedText) {
    if (!normalizedText || normalizedText.length < 5) return null;
    const slice = normalizedText.slice(0, 120);
    return crypto.createHash('md5').update(slice).digest('hex');
}

/**
 * Check if current time is within the night window.
 */
export function isNightWindow(startStr, endStr, tz = config.timezone) {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    });
    const nowTime = fmt.format(now); // "HH:MM"

    const toMin = (s) => {
        const [h, m] = s.split(':').map(Number);
        return h * 60 + m;
    };

    const nowMin = toMin(nowTime);
    const startMin = toMin(startStr);
    const endMin = toMin(endStr);

    if (startMin <= endMin) {
        return nowMin >= startMin && nowMin < endMin;
    }
    // Crosses midnight (e.g. 23:00 – 08:00)
    return nowMin >= startMin || nowMin < endMin;
}

/**
 * Format candidate for Telegram message.
 */
export function formatCandidate(c) {
    const trend = c.trend ? '🔥 TREND' : '';
    const scores = [];
    if (c.score_5mini != null) scores.push(`5mini: ${c.score_5mini}`);
    if (c.score_flash != null) scores.push(`flash: ${c.score_flash}`);
    if (c.score_pro != null) scores.push(`pro: ${c.score_pro}`);

    const labelEmoji = {
        'normal': '📝',
        'şüpheli': '⚠️',
        'iyi aday': '👍',
        'çok iyi': '🚀',
        'auto-send adayı': '⚡',
    };

    const emoji = labelEmoji[c.label] || '📋';
    const mediaLine = c.media_urls ? `\n🖼 Medya: ${JSON.parse(c.media_urls).length} adet` : '';

    return `${emoji} <b>#${c.id}</b> | @${c.account} ${trend}
${c.label ? `Etiket: <b>${c.label}</b>` : ''}
${scores.length ? `Skorlar: ${scores.join(' | ')}` : ''}
${c.similar_count_10m > 0 ? `📊 Benzer: ${c.similar_count_10m} hesap` : ''}
${c.score_reason ? `💡 ${c.score_reason}` : ''}

${c.rewritten_text || c.text}${mediaLine}`;
}

/**
 * Truncate text to given length.
 */
export function truncate(text, len = 280) {
    if (!text) return '';
    if (text.length <= len) return text;
    return text.slice(0, len - 3) + '...';
}

/**
 * Sleep utility.
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safe JSON parse.
 */
export function safeJsonParse(str, fallback = null) {
    try { return JSON.parse(str); } catch { return fallback; }
}
