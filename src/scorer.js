import config from './config.js';
import { updateCandidate } from './db.js';
import { isNightWindow } from './utils.js';
import { runReplicateModel, parseJsonFromText } from './llm.js';

const SYSTEM_PROMPT = `Sen bir Türkiye haber/sosyal medya analistisin. Sana verilen tweeti analiz et ve Türkiye'de viral olma potansiyelini 0-100 arasında puanla.

Puanlama kriterleri:
- Güncellik ve haber değeri (breaking news bonus)
- Duygusal etki (şok, merak, endişe, gurur)
- Türk halkının ilgi alanlarıyla örtüşme
- Paylaşılabilirlik potansiyeli
- Tartışma yaratma potansiyeli

Yanıtını SADECE şu JSON formatında ver:
{"score": <0-100>, "reason": "<maksimum 50 kelimelik kısa açıklama>"}`;

/**
 * Call GPT-5 Mini for initial scoring.
 */
async function callGPT5Mini(text) {
    try {
        const responseText = await runReplicateModel(config.models.gptMini, {
            system_prompt: SYSTEM_PROMPT,
            prompt: text,
            reasoning_effort: 'minimal',
            verbosity: 'medium',
            max_completion_tokens: 200,
        });
        const parsed = parseJsonFromText(responseText);
        if (!parsed) return null;
        return { score: Math.round(parsed.score), reason: parsed.reason || '' };
    } catch (err) {
        console.error('[Scorer] GPT-5 Mini error:', err.message);
        return null;
    }
}

/**
 * Call Gemini Flash for second-tier scoring.
 */
async function callGeminiFlash(text) {
    try {
        const responseText = await runReplicateModel(config.models.geminiFlash, {
            system_instruction: SYSTEM_PROMPT,
            prompt: text,
            temperature: 0.3,
            max_output_tokens: 200,
        });
        const parsed = parseJsonFromText(responseText);
        if (!parsed) return null;
        return { score: Math.round(parsed.score), reason: parsed.reason || '' };
    } catch (err) {
        console.error('[Scorer] Gemini Flash error:', err.message);
        return null;
    }
}

/**
 * Call Gemini Pro for final-tier scoring (auto-send verification).
 */
async function callGeminiPro(text) {
    try {
        const responseText = await runReplicateModel(config.models.geminiPro, {
            system_instruction: SYSTEM_PROMPT,
            prompt: `Bu tweet otomatik paylaşım için değerlendiriliyor. Çok yüksek standart uygula.\n\nTweet:\n${text}`,
            temperature: 0.2,
            max_output_tokens: 200,
        });
        const parsed = parseJsonFromText(responseText);
        if (!parsed) return null;
        return { score: Math.round(parsed.score), reason: parsed.reason || '' };
    } catch (err) {
        console.error('[Scorer] Gemini Pro error:', err.message);
        return null;
    }
}

/**
 * Run the full scoring cascade on a candidate.
 *
 * Returns:
 *   { label, action, scores: { score_5mini, score_flash?, score_pro? }, reason }
 *   action: 'drop' | 'suggest' | 'auto-send'
 */
export async function scoringCascade(candidate) {
    const text = candidate.text;
    const id = candidate.id;
    const trend = candidate.trend;

    // Step 1: GPT-5 Mini
    const mini = await callGPT5Mini(text);
    if (!mini) {
        updateCandidate(id, { status: 'dropped', score_reason: 'scoring-error' });
        return { label: null, action: 'drop', scores: {}, reason: 'scoring-error' };
    }

    updateCandidate(id, { score_5mini: mini.score, score_reason: mini.reason });

    if (mini.score < 70) {
        updateCandidate(id, { status: 'dropped', label: 'dropped' });
        return { label: 'dropped', action: 'drop', scores: { score_5mini: mini.score }, reason: mini.reason };
    }

    if (mini.score < 85) {
        updateCandidate(id, { status: 'scored', label: 'normal' });
        return { label: 'normal', action: 'suggest', scores: { score_5mini: mini.score }, reason: mini.reason };
    }

    // Step 2: Gemini Flash (score_5mini >= 85)
    const flash = await callGeminiFlash(text);
    if (!flash) {
        updateCandidate(id, { status: 'scored', label: 'normal' });
        return { label: 'normal', action: 'suggest', scores: { score_5mini: mini.score }, reason: 'flash-error-fallback' };
    }

    updateCandidate(id, { score_flash: flash.score });

    let label;
    if (flash.score < 80) {
        label = 'şüpheli';
    } else if (flash.score < 88) {
        label = 'iyi aday';
    } else {
        label = 'çok iyi';
    }

    // Check auto-send eligibility
    const autoSendCandidate = flash.score >= 90 && mini.score >= 92;
    if (autoSendCandidate) {
        label = 'auto-send adayı';
    }

    const combinedReason = `5mini: ${mini.reason} | flash: ${flash.reason}`;
    updateCandidate(id, { status: 'scored', label, score_reason: combinedReason });

    // Step 3: Pro check (only for auto-send candidates)
    const autoEnabled = config.autoSend;
    const inNight = isNightWindow(config.nightStart, config.nightEnd);
    const nightOrTrend = (config.nightMode && inNight) || trend;

    if (autoSendCandidate && autoEnabled && nightOrTrend && mini.score >= 92 && flash.score >= 88) {
        const pro = await callGeminiPro(text);
        if (pro) {
            updateCandidate(id, { score_pro: pro.score, score_reason: `${combinedReason} | pro: ${pro.reason}` });

            if (pro.score >= 90) {
                return {
                    label: 'auto-send',
                    action: 'auto-send',
                    scores: { score_5mini: mini.score, score_flash: flash.score, score_pro: pro.score },
                    reason: pro.reason,
                };
            }
        }
    }

    return {
        label,
        action: 'suggest',
        scores: { score_5mini: mini.score, score_flash: flash.score },
        reason: combinedReason,
    };
}
