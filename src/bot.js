import { Bot, InlineKeyboard } from 'grammy';
import config from './config.js';
import {
    getAccounts, addAccount, removeAccount, updateAccountInterval,
    pauseAccount, resumeAccount, getCandidate, updateCandidate,
    getSimilarAccounts, getTodayStats,
} from './db.js';
import { formatCandidate, safeJsonParse } from './utils.js';
import { rewriteTweet } from './rewriter.js';
import { sendTweet } from './sender.js';

let bot;
let onAccountChange = null; // callback for pipeline to react to account changes

export function setAccountChangeCallback(cb) {
    onAccountChange = cb;
}

function isAdmin(ctx) {
    return ctx.from?.id === config.telegram.adminId;
}

function adminOnly(ctx, next) {
    if (!isAdmin(ctx)) {
        return ctx.reply('⛔ Bu komutu yalnızca admin kullanabilir.');
    }
    return next();
}

export function createBot() {
    bot = new Bot(config.telegram.token);

    // Middleware: admin check for all commands
    bot.use(async (ctx, next) => {
        if (ctx.message?.text?.startsWith('/') || ctx.callbackQuery) {
            if (!isAdmin(ctx)) {
                if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: '⛔ Admin değilsin.' });
                else await ctx.reply('⛔ Bu komutu yalnızca admin kullanabilir.');
                return;
            }
        }
        await next();
    });

    // ——— COMMANDS ———

    bot.command('start', async (ctx) => {
        await ctx.reply(
            '🚀 <b>TweetGrowth Bot</b>\n\n' +
            'Tweet kürasyon pipeline\'ı aktif.\n' +
            'Komutlar için /help yazın.',
            { parse_mode: 'HTML' }
        );
    });

    bot.command('help', async (ctx) => {
        await ctx.reply(
            '📋 <b>Komutlar</b>\n\n' +
            '/accounts — Takip listesi\n' +
            '/add &lt;username&gt; &lt;interval_sec&gt; — Hesap ekle\n' +
            '/remove &lt;username&gt; — Hesap sil\n' +
            '/interval &lt;username&gt; &lt;sec&gt; — Aralık güncelle\n' +
            '/pause &lt;username&gt; — Duraklat\n' +
            '/resume &lt;username&gt; — Devam ettir\n' +
            '/pauseall — Tüm hesapları durdur\n' +
            '/resumeall — Tüm hesapları başlat\n' +
            '/stop — /pauseall kısayolu\n' +
            '/auto on|off — Otomatik gönderim\n' +
            '/night on|off — Gece modu\n' +
            '/nightwindow &lt;HH:MM&gt; &lt;HH:MM&gt; — Gece aralığı\n' +
            '/similar &lt;candidate_id&gt; — Benzer paylaşımlar\n' +
            '/stats — Bugünkü istatistikler',
            { parse_mode: 'HTML' }
        );
    });

    bot.command('accounts', async (ctx) => {
        const accounts = getAccounts();
        if (accounts.length === 0) {
            return ctx.reply('📋 Takip listesi boş.');
        }
        const lines = accounts.map(a => {
            const status = a.active ? '✅' : '⏸️';
            return `${status} @${a.username} — ${a.poll_interval}s`;
        });
        await ctx.reply(`📋 <b>Takip Listesi</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
    });

    bot.command('add', async (ctx) => {
        const parts = ctx.message.text.split(/\s+/);
        if (parts.length < 2) return ctx.reply('Kullanım: /add <username> [interval_sec]');
        const username = parts[1].replace('@', '');
        const interval = parseInt(parts[2]) || config.defaultPollInterval;
        addAccount(username, interval);
        if (onAccountChange) onAccountChange('add', username, interval);
        await ctx.reply(`✅ @${username} eklendi (${interval}s aralık)`);
    });

    bot.command('remove', async (ctx) => {
        const parts = ctx.message.text.split(/\s+/);
        if (parts.length < 2) return ctx.reply('Kullanım: /remove <username>');
        const username = parts[1].replace('@', '');
        removeAccount(username);
        if (onAccountChange) onAccountChange('remove', username);
        await ctx.reply(`🗑️ @${username} silindi`);
    });

    bot.command('interval', async (ctx) => {
        const parts = ctx.message.text.split(/\s+/);
        if (parts.length < 3) return ctx.reply('Kullanım: /interval <username> <sec>');
        const username = parts[1].replace('@', '');
        const interval = parseInt(parts[2]);
        if (!interval || interval < 30) return ctx.reply('⚠️ Minimum aralık 30 saniye.');
        updateAccountInterval(username, interval);
        if (onAccountChange) onAccountChange('interval', username, interval);
        await ctx.reply(`⏱️ @${username} aralığı: ${interval}s`);
    });

    bot.command('pause', async (ctx) => {
        const parts = ctx.message.text.split(/\s+/);
        if (parts.length < 2) return ctx.reply('Kullanım: /pause <username>');
        const username = parts[1].replace('@', '');
        pauseAccount(username);
        if (onAccountChange) onAccountChange('pause', username);
        await ctx.reply(`⏸️ @${username} duraklatıldı`);
    });

    bot.command('resume', async (ctx) => {
        const parts = ctx.message.text.split(/\s+/);
        if (parts.length < 2) return ctx.reply('Kullanım: /resume <username>');
        const username = parts[1].replace('@', '');
        resumeAccount(username);
        if (onAccountChange) onAccountChange('resume', username);
        await ctx.reply(`▶️ @${username} devam ediyor`);
    });

    bot.command('pauseall', async (ctx) => {
        const accounts = getAccounts().filter(a => a.active);
        for (const a of accounts) {
            pauseAccount(a.username);
            if (onAccountChange) onAccountChange('pause', a.username);
        }
        await ctx.reply(`⏸️ Tüm hesaplar durduruldu (${accounts.length} hesap).`);
    });

    bot.command('resumeall', async (ctx) => {
        const accounts = getAccounts().filter(a => !a.active);
        for (const a of accounts) {
            resumeAccount(a.username);
            if (onAccountChange) onAccountChange('resume', a.username, a.poll_interval);
        }
        await ctx.reply(`▶️ Tüm hesaplar başlatıldı (${accounts.length} hesap).`);
    });

    bot.command('stop', async (ctx) => {
        const accounts = getAccounts().filter(a => a.active);
        for (const a of accounts) {
            pauseAccount(a.username);
            if (onAccountChange) onAccountChange('pause', a.username);
        }
        await ctx.reply(`🛑 Pipeline durduruldu (/pauseall). (${accounts.length} hesap)`);
    });

    bot.command('auto', async (ctx) => {
        const parts = ctx.message.text.split(/\s+/);
        if (parts.length < 2) return ctx.reply('Kullanım: /auto on|off');
        const val = parts[1].toLowerCase();
        config.autoSend = val === 'on';
        await ctx.reply(`⚡ Otomatik gönderim: ${config.autoSend ? 'AÇIK' : 'KAPALI'}`);
    });

    bot.command('night', async (ctx) => {
        const parts = ctx.message.text.split(/\s+/);
        if (parts.length < 2) return ctx.reply('Kullanım: /night on|off');
        const val = parts[1].toLowerCase();
        config.nightMode = val === 'on';
        await ctx.reply(`🌙 Gece modu: ${config.nightMode ? 'AÇIK' : 'KAPALI'}`);
    });

    bot.command('nightwindow', async (ctx) => {
        const parts = ctx.message.text.split(/\s+/);
        if (parts.length < 3) return ctx.reply('Kullanım: /nightwindow <HH:MM> <HH:MM>');
        config.nightStart = parts[1];
        config.nightEnd = parts[2];
        await ctx.reply(`🌙 Gece penceresi: ${config.nightStart} - ${config.nightEnd} (Europe/Istanbul)`);
    });

    bot.command('similar', async (ctx) => {
        const parts = ctx.message.text.split(/\s+/);
        if (parts.length < 2) return ctx.reply('Kullanım: /similar <candidate_id>');
        const id = parseInt(parts[1]);
        const candidate = getCandidate(id);
        if (!candidate) return ctx.reply('❌ Aday bulunamadı.');
        if (!candidate.fingerprint) return ctx.reply('⚠️ Bu adayın fingerprint\'i yok.');

        const accounts = getSimilarAccounts(candidate.fingerprint);
        if (accounts.length === 0) return ctx.reply('🔍 Benzer paylaşım bulunamadı.');

        await ctx.reply(
            `🔍 <b>#${id} ile benzer paylaşan hesaplar:</b>\n\n` +
            accounts.map(a => `• @${a}`).join('\n'),
            { parse_mode: 'HTML' }
        );
    });

    bot.command('stats', async (ctx) => {
        const s = getTodayStats();
        await ctx.reply(
            `📊 <b>Bugünkü İstatistikler</b>\n\n` +
            `📥 Toplanan: ${s.collected}\n` +
            `🗑️ Drop: ${s.dropped}\n` +
            `📨 Telegram: ${s.suggested}\n` +
            `✅ Gönderilen: ${s.sent}\n` +
            `⏭️ Atlanan: ${s.skipped}`,
            { parse_mode: 'HTML' }
        );
    });

    // ——— CALLBACK QUERIES (Inline Buttons) ———

    bot.on('callback_query:data', async (ctx) => {
        const data = ctx.callbackQuery.data;
        const [action, idStr] = data.split(':');
        const candidateId = parseInt(idStr);

        if (!candidateId) {
            return ctx.answerCallbackQuery({ text: '⚠️ Geçersiz ID' });
        }

        const candidate = getCandidate(candidateId);
        if (!candidate) {
            return ctx.answerCallbackQuery({ text: '❌ Aday bulunamadı' });
        }

        switch (action) {
            case 'rewrite': {
                await ctx.answerCallbackQuery({ text: '✍️ Yeniden yazılıyor...' });
                const rewritten = await rewriteTweet(candidate.text);
                if (!rewritten) {
                    return ctx.reply('❌ Rewrite başarısız oldu.');
                }
                updateCandidate(candidateId, { rewritten_text: rewritten, status: 'rewritten' });

                const keyboard = new InlineKeyboard()
                    .text('🐦 Tweet At', `tweet:${candidateId}`)
                    .text('✍️ Tekrar Yaz', `rewrite:${candidateId}`)
                    .text('❌ İptal', `cancel:${candidateId}`);

                await ctx.reply(
                    `✍️ <b>Yeniden Yazıldı (#${candidateId})</b>\n\n${rewritten}`,
                    { parse_mode: 'HTML', reply_markup: keyboard }
                );
                break;
            }

            case 'skip': {
                updateCandidate(candidateId, { status: 'skipped' });
                await ctx.answerCallbackQuery({ text: '⏭️ Atlandı' });
                await ctx.editMessageReplyMarkup({ reply_markup: undefined });
                break;
            }

            case 'source': {
                const url = `https://x.com/${candidate.account}/status/${candidate.tweet_id}`;
                await ctx.answerCallbackQuery({ text: '🔗 Kaynak' });
                await ctx.reply(`🔗 <a href="${url}">Orijinal Tweet</a>`, { parse_mode: 'HTML' });
                break;
            }

            case 'similar': {
                if (!candidate.fingerprint) {
                    return ctx.answerCallbackQuery({ text: '⚠️ Fingerprint yok' });
                }
                const accounts = getSimilarAccounts(candidate.fingerprint);
                await ctx.answerCallbackQuery({ text: `${accounts.length} hesap` });
                if (accounts.length > 0) {
                    await ctx.reply(
                        `🔍 <b>#${candidateId} benzerleri:</b>\n${accounts.map(a => `• @${a}`).join('\n')}`,
                        { parse_mode: 'HTML' }
                    );
                } else {
                    await ctx.reply('🔍 Benzer bulunamadı.');
                }
                break;
            }

            case 'tweet': {
                await ctx.answerCallbackQuery({ text: '📤 Gönderiliyor...' });
                const textToSend = candidate.rewritten_text || candidate.text;
                const mediaUrls = candidate.media_urls ? safeJsonParse(candidate.media_urls) : null;
                const result = await sendTweet(textToSend, mediaUrls, candidateId);

                if (result.success) {
                    await ctx.reply(
                        `✅ <b>Tweet gönderildi!</b>\n${result.tweetUrl}`,
                        { parse_mode: 'HTML' }
                    );
                } else {
                    await ctx.reply(`❌ <b>Hata:</b> ${result.error}`, { parse_mode: 'HTML' });
                }
                await ctx.editMessageReplyMarkup({ reply_markup: undefined });
                break;
            }

            case 'cancel': {
                updateCandidate(candidateId, { status: 'skipped' });
                await ctx.answerCallbackQuery({ text: '❌ İptal edildi' });
                await ctx.editMessageReplyMarkup({ reply_markup: undefined });
                break;
            }

            default:
                await ctx.answerCallbackQuery({ text: '⚠️ Bilinmeyen işlem' });
        }
    });

    return bot;
}

/**
 * Send a candidate notification to admin via Telegram.
 */
export async function notifyCandidate(candidate) {
    if (!bot) return;

    const text = formatCandidate(candidate);

    const keyboard = new InlineKeyboard()
        .text('✍️ Rewrite', `rewrite:${candidate.id}`)
        .text('⏭️ Skip', `skip:${candidate.id}`)
        .row()
        .text('🔗 Source', `source:${candidate.id}`)
        .text('🔍 Similar', `similar:${candidate.id}`);

    try {
        const msg = await bot.api.sendMessage(config.telegram.adminId, text, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
        });
        updateCandidate(candidate.id, { telegram_msg_id: msg.message_id, status: 'suggested' });
    } catch (err) {
        console.error('[Bot] Failed to send notification:', err.message);
    }
}

/**
 * Send a simple text message to admin.
 */
export async function notifyAdmin(message) {
    if (!bot) return;
    try {
        await bot.api.sendMessage(config.telegram.adminId, message, { parse_mode: 'HTML' });
    } catch (err) {
        console.error('[Bot] Failed to notify admin:', err.message);
    }
}

/**
 * Start the bot.
 */
export function startBot() {
    if (!bot) createBot();
    bot.start({
        onStart: () => console.log('[Bot] Telegram bot started'),
    });
    return bot;
}
