import 'dotenv/config';

function required(key) {
  const val = process.env[key];
  if (!val) {
    console.warn(`⚠️  Missing required env var: ${key}`);
  }
  return val || '';
}

const config = {
  // RapidAPI
  rapidapi: {
    key: required('RAPIDAPI_KEY'),
    host: process.env.RAPIDAPI_HOST || 'twitter-api45.p.rapidapi.com',
  },

  // Replicate (LLM provider)
  replicate: {
    apiToken: required('REPLICATE_API_TOKEN'),
  },

  // Models via Replicate
  models: {
    gptMini: process.env.MODEL_GPT_MINI || 'openai/gpt-5-mini',
    geminiFlash: process.env.MODEL_GEMINI_FLASH || 'google/gemini-3-flash',
    geminiPro: process.env.MODEL_GEMINI_PRO || 'google/gemini-3.1-pro',
  },

  // Telegram
  telegram: {
    token: required('TELEGRAM_BOT_TOKEN'),
    adminId: Number(required('TELEGRAM_ADMIN_ID')),
  },

  // X / Twitter
  x: {
    apiKey: required('X_API_KEY'),
    apiSecret: required('X_API_SECRET'),
    accessToken: required('X_ACCESS_TOKEN'),
    accessSecret: required('X_ACCESS_SECRET'),
  },

  // App
  dryRun: process.env.DRY_RUN === 'true',
  timezone: process.env.TIMEZONE || 'Europe/Istanbul',
  nightMode: process.env.NIGHT_MODE === 'true',
  nightStart: process.env.NIGHT_START || '23:00',
  nightEnd: process.env.NIGHT_END || '08:00',
  autoSend: process.env.AUTO_SEND === 'true',

  // Default poll interval for new accounts (seconds)
  defaultPollInterval: 300,
};

export default config;
