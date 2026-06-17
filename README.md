# Anka Loyalty

Shopify mağazaları için white-label sadakat programı uygulaması. 

## Stack

| Katman | Teknoloji |
|---|---|
| Framework | Remix (`@shopify/shopify-app-remix`) |
| Admin UI | Polaris (embedded) |
| Veritabanı | Supabase (PostgreSQL + RLS) |
| Deploy | Railway |
| E-posta | Klaviyo (event push) |
| Hata takibi | Sentry |

## Geliştirme

```bash
npm install
cp .env.example .env   # değerleri doldur
npm run supabase:check # Supabase API baglantisi
npm run db:check       # Postgres (SUPABASE_DB_URL) baglantisi
npm run dev            # shopify app dev (Partner hesabı login ister)
```

Şema dokümantasyonu: [`docs/database-schema.md`](./docs/database-schema.md)

> Not: Session storage şu an template varsayılanı olan Prisma + SQLite. Gün 2-3'te Supabase'e taşınacak.


