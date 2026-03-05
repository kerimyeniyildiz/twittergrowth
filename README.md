# TweetGrowth 🚀

Tweet kürasyon pipeline: X hesaplarından tweet topla → dedup → LLM ile puanla → Telegram'dan onayla → X'e paylaş.

## Mimari

```
                    ┌─────────────┐
                    │  RapidAPI   │
                    │ (X Timeline)│
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Collector  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Dedup &    │──→ DROP (duplicate/similar)
                    │ Fingerprint │
                    └──────┬──────┘
                           │
            ┌──────────────▼──────────────┐
            │    Scoring Cascade          │
            │ GPT-5 Mini → Flash → Pro    │──→ DROP (<70)
            └──────────────┬──────────────┘
                           │
              ┌────────────▼────────────┐
              │   Telegram Bot          │
              │ [Rewrite][Skip][Source]  │
              └────────────┬────────────┘
                           │
                    ┌──────▼──────┐
                    │  X API      │
                    │  Sender     │
                    └─────────────┘
```

## Kurulum

```bash
# Clone & install
git clone <repo>
cd tweetgrowth
npm install

# Env dosyasını oluştur
cp .env.example .env
# .env dosyasını kendi API key'lerinle doldur
```

## Ortam Değişkenleri

| Değişken | Açıklama |
|---|---|
| `RAPIDAPI_KEY` | RapidAPI anahtarı (Twitter API) |
| `RAPIDAPI_HOST` | RapidAPI host (varsayılan: twitter-api45.p.rapidapi.com) |
| `REPLICATE_API_TOKEN` | Replicate API token (tüm LLM çağrıları) |
| `MODEL_GPT_MINI` | Skorlama modeli (varsayılan: `openai/gpt-5-mini`) |
| `MODEL_GEMINI_FLASH` | Flash modeli (varsayılan: `google/gemini-3-flash`) |
| `MODEL_GEMINI_PRO` | Pro modeli (varsayılan: `google/gemini-3.1-pro`) |
| `TELEGRAM_BOT_TOKEN` | Telegram botunun token'ı |
| `TELEGRAM_ADMIN_ID` | Admin kullanıcının Telegram ID'si |
| `X_API_KEY` | X API key |
| `X_API_SECRET` | X API secret |
| `X_ACCESS_TOKEN` | X access token |
| `X_ACCESS_SECRET` | X access secret |
| `DRY_RUN` | `true` olursa tweet göndermez (test modu) |
| `AUTO_SEND` | `true` olursa yüksek skorlu tweetleri otomatik gönderir |
| `NIGHT_MODE` | Gece modu açık/kapalı |
| `NIGHT_START` | Gece başlangıç saati (varsayılan: 23:00) |
| `NIGHT_END` | Gece bitiş saati (varsayılan: 08:00) |

## Çalıştırma

```bash
# Normal mod
npm start

# Dry-run (tweet göndermez)
npm run dry-run

# Geliştirme (auto-reload)
npm run dev

# Testler
npm test
```

## Telegram Komutları

| Komut | Açıklama |
|---|---|
| `/accounts` | Takip listesi + aralık + durum |
| `/add <user> <sec>` | Hesap ekle |
| `/remove <user>` | Hesap sil |
| `/interval <user> <sec>` | Tarama aralığı güncelle |
| `/pause <user>` | Durakla |
| `/resume <user>` | Devam ettir |
| `/pauseall` | Tüm hesapları durdur |
| `/resumeall` | Tüm hesapları başlat |
| `/stop` | Pipeline'ı tek komutla durdurur (`/pauseall`) |
| `/auto on\|off` | Otomatik gönderim aç/kapa |
| `/night on\|off` | Gece modu aç/kapa |
| `/nightwindow <HH:MM> <HH:MM>` | Gece penceresi ayarla |
| `/similar <id>` | Benzer paylaşan hesapları göster |
| `/stats` | Bugünkü istatistikler |

## Skorlama Cascade

```
GPT-5 Mini (0-100)
  < 70  → DROP
  70-84 → Telegram "normal" 📝
  85+   → Gemini Flash ↓

Gemini Flash (0-100)
  < 80  → "şüpheli" ⚠️
  80-87 → "iyi aday" 👍
  88+   → "çok iyi" 🚀
  flash≥90 AND 5mini≥92 → "auto-send adayı" ⚡

Auto-send kontrolü (Gemini Pro):
  Koşul: auto=ON AND (gece penceresi OR trend)
  pro ≥ 90 → OTOMATİK TWEET
  pro < 90 → Telegram onayı
```

## Proje Yapısı

```
src/
├── index.js       # Giriş noktası
├── config.js      # Ortam değişkenleri
├── db.js          # SQLite veritabanı
├── collector.js   # RapidAPI tweet toplayıcı
├── dedup.js       # Dedup & fingerprint
├── scorer.js      # LLM skorlama cascade
├── rewriter.js    # Tweet yeniden yazma
├── sender.js      # X API gönderici
├── bot.js         # Telegram bot
├── pipeline.js    # Orkestratör
└── utils.js       # Yardımcı fonksiyonlar
tests/
├── dedup.test.js
├── scorer.test.js
└── pipeline.test.js
```

## Dokploy Deploy (GitHub)

1. Repoyu GitHub'a push et.
2. Dokploy'de **New Application** → **Dockerfile** seç.
3. Repo'yu bağla ve branch seç (`main` gibi).
4. Build context: `/`
5. Dockerfile path: `/Dockerfile`
6. **Persistent Volume** ekle:
   - Container path: `/app/data`
7. Env değişkenlerini Dokploy'de gir (`.env` içeriğinin aynısı, gizli alanlar dahil).
8. İlk test için önerilen değerler:
   - `DRY_RUN=true`
   - `AUTO_SEND=false`
9. Deploy et.

Doğrulama:
- Telegram'da bota `/start`, `/accounts`, `/stats` gönder.
- Çok fazla yükte Replicate 429 alırsan `/pauseall` ile durdurup daha az hesapla devam et.
