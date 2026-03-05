import config from './config.js';
import { initDB, seedAccounts, getAccounts } from './db.js';
import { createBot, startBot } from './bot.js';
import { startPipeline } from './pipeline.js';

const INITIAL_ACCOUNTS = [
    'anadoluajansi',
    'nowhaber',
    'siyahsancakx',
    'darkwebhaber',
    'Pusholder',
    'onedio',
    'bosunatiklama',
    'ConflictTR',
    'etkilihaberyeni',
    'bpthaber',
    'yirmiucderece',
    'populicc',
];

async function main() {
    console.log('🚀 TweetGrowth starting...');
    console.log(`   Mode: ${config.dryRun ? 'DRY-RUN' : 'LIVE'}`);
    console.log(`   Auto-send: ${config.autoSend ? 'ON' : 'OFF'}`);
    console.log(`   Night mode: ${config.nightMode ? 'ON' : 'OFF'} (${config.nightStart}-${config.nightEnd})`);

    // 1. Initialize database
    const db = initDB();
    console.log('✅ Database initialized');

    // 2. Seed initial accounts if DB is empty
    const existing = getAccounts();
    if (existing.length === 0) {
        seedAccounts(INITIAL_ACCOUNTS, config.defaultPollInterval);
        console.log(`✅ Seeded ${INITIAL_ACCOUNTS.length} initial accounts`);
    } else {
        console.log(`📋 ${existing.length} account(s) in DB`);
    }

    // 3. Create and start Telegram bot
    createBot();
    startBot();
    console.log('✅ Telegram bot started');

    // 4. Start pipeline
    startPipeline();
    console.log('✅ Pipeline started');

    console.log('\n🟢 TweetGrowth is running. Press Ctrl+C to stop.\n');

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down...');
        db.close();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n🛑 Shutting down...');
        db.close();
        process.exit(0);
    });
}

main().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});
