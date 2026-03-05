import config from './config.js';

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

function normalizeOutput(output) {
    if (Array.isArray(output)) return output.join('').trim();
    if (typeof output === 'string') return output.trim();
    if (output == null) return '';
    return String(output).trim();
}

async function pollPrediction(getUrl, headers, maxPolls = 20, sleepMs = 1000) {
    for (let i = 0; i < maxPolls; i++) {
        const res = await fetch(getUrl, { headers });
        const pred = await res.json();

        if (!res.ok) {
            throw new Error(`Replicate polling failed: ${res.status} ${JSON.stringify(pred)}`);
        }
        if (pred.status === 'succeeded') return pred;
        if (pred.status === 'failed' || pred.status === 'canceled') {
            throw new Error(`Replicate prediction ${pred.status}: ${pred.error || 'unknown error'}`);
        }

        await new Promise(resolve => setTimeout(resolve, sleepMs));
    }
    throw new Error('Replicate prediction timed out');
}

export async function runReplicateModel(model, input, waitSeconds = 60) {
    const headers = {
        Authorization: `Bearer ${config.replicate.apiToken}`,
        'Content-Type': 'application/json',
        Prefer: `wait=${waitSeconds}`,
    };

    let pred;
    let res;
    for (let attempt = 1; attempt <= 5; attempt++) {
        res = await fetch(`${REPLICATE_API_BASE}/models/${model}/predictions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ input }),
        });
        pred = await res.json();

        if (res.ok) break;
        if (res.status === 429 && attempt < 5) {
            const retryAfterSec = Number(pred?.retry_after) || 5;
            await new Promise(resolve => setTimeout(resolve, retryAfterSec * 1000));
            continue;
        }
        throw new Error(`Replicate request failed: ${res.status} ${JSON.stringify(pred)}`);
    }

    if (pred.status === 'succeeded') {
        return normalizeOutput(pred.output);
    }
    if (pred.status === 'failed' || pred.status === 'canceled') {
        throw new Error(`Replicate prediction ${pred.status}: ${pred.error || 'unknown error'}`);
    }
    if (!pred.urls?.get) {
        throw new Error('Replicate prediction pending but no poll URL was provided');
    }

    const completed = await pollPrediction(pred.urls.get, headers);
    return normalizeOutput(completed.output);
}

export function parseJsonFromText(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
}
