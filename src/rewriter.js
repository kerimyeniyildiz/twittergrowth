import config from './config.js';
import { runReplicateModel } from './llm.js';

const REWRITE_PROMPT = `Sen bir Türk sosyal medya editörüsün. Aşağıdaki haberi/tweeti yeniden yaz.

Kurallar:
- Maksimum 280 karakter
- Kısa, akıcı ve merak uyandıran bir dil kullan
- Aşırı clickbait yapma, güvenilir haber tonu koru
- Türkiye halkına uygun, samimi bir dil
- Emoji kullanabilirsin ama abartma (maks 2)
- Hashtag ekleme
- Sadece yeniden yazılmış tweeti döndür, başka bir şey yazma

Orijinal tweet:`;

/**
 * Rewrite a tweet in Turkish news style.
 * Returns the rewritten text or null on error.
 */
export async function rewriteTweet(originalText) {
    try {
        let text = await runReplicateModel(config.models.geminiFlash, {
            system_instruction: REWRITE_PROMPT,
            prompt: originalText,
            temperature: 0.7,
            max_output_tokens: 300,
        });

        // Clean up any quotes that might wrap the response
        if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
            text = text.slice(1, -1);
        }

        // Ensure 280 char limit
        if (text.length > 280) {
            text = text.slice(0, 277) + '...';
        }

        return text;
    } catch (err) {
        console.error('[Rewriter] Error:', err.message);
        return null;
    }
}
