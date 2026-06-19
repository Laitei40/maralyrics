# MaraLyrics

A modern, lightweight Mara song lyrics website. The project serves a static frontend from `public/` and uses Cloudflare Workers + D1 for dynamic pages and data.

---

## Project layout

```
maralyrics/
├── public/                 # Static site assets (HTML, CSS, JS)
│   ├── index.html
│   ├── songview.html
│   ├── artistview.html
│   ├── composerview.html
│   ├── copyrightownerview.html
│   ├── style.css
│   └── app.js
├── functions/              # Cloudflare Functions / route handlers
│   ├── sitemap.xml.js      # /sitemap.xml
│   ├── song/[[catchall]].js
│   ├── artist/[[catchall]].js
│   ├── composer/[[catchall]].js
│   └── copyright-owner/[[catchall]].js
├── schema.sql              # D1 database schema + seed data
├── wrangler.toml           # Cloudflare configuration (site + D1 bindings)
├── package.json            # npm scripts (dev, deploy, db tasks)
└── README.md               # This file
```

---

## Prerequisites

- Node.js v18+
- Wrangler CLI v3+ (`npm install -g wrangler` or use the locally installed `wrangler`)
- A Cloudflare account with D1 access (or local D1 for development)

---

## Quick start (local)

1. Install dependencies

```bash
npm install
```

2. Login to Cloudflare

```bash
npx wrangler login
```

3. Create a D1 database (one-time)

```bash
npm run db:create
```

Copy the printed `database_id` and update the `[[d1_databases]]` entry in `wrangler.toml`.

4. Run migration locally

```bash
npm run db:migrate:local
```

5. Start local dev server (wrangler dev serves the `public/` site and functions)

```bash
npm run dev
```

Open http://localhost:8787 in your browser.

---

## Deploy

```bash
npm run deploy
```

This uses `wrangler deploy` and the config in `wrangler.toml` (site bucket, D1 bindings, routes).

---

## Routing & behavior

- Static content is served from `public/` as a Cloudflare Site.
- Dynamic page handlers live in `functions/` — each catch-all serves the corresponding view (`songview.html`, `artistview.html`, etc.) and injects SEO metadata when available.
- A sitemap is generated at `/sitemap.xml` by `functions/sitemap.xml.js` using the D1 `songs` table.
- Database access is performed via the D1 binding named `DB` (see `wrangler.toml`).

---

## Scripts

The important npm scripts are defined in `package.json`:

- `npm run dev` — `wrangler dev` (local development)
- `npm run deploy` — `wrangler deploy` (production deploy)
- `npm run db:create` — create a D1 database (`wrangler d1 create`)
- `npm run db:migrate` — run migrations against remote D1
- `npm run db:migrate:local` — run migrations against local D1

---

## Adding songs

You can insert songs directly into the D1 `songs` table. Example SQL:

```sql
INSERT INTO songs (title, slug, artist, category, lyrics) VALUES
('Song Title', 'song-title-slug', 'Artist Name', 'Category', 'Lyrics line 1\nLine 2\n...');
```

You can execute ad-hoc commands with Wrangler:

```bash
npx wrangler d1 execute maralyrics-db --command="INSERT INTO songs ..."
```

---

## Notes

- `wrangler.toml` in this repository contains the D1 binding and site bucket. Update `database_id` after creating your D1 instance.
- This project serves pre-rendered HTML views and uses client-side JS to fetch and render data where appropriate.

---

## License

MIT License — Copyright (c) 2026 Maralyrics
