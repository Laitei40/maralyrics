# MaraLyrics

A modern, high-performance Mara song lyrics website built with Cloudflare Workers, D1 database, and vanilla HTML/CSS/JS featuring glassmorphism UI with smart offline caching.

---

## Project Structure

```
maralyrics/
├── public/              # Frontend static files
│   ├── index.html       # Home page (song list, search, categories)
│   ├── song.html        # Single song lyrics page
│   ├── style.css        # Full CSS (Glass UI, dark mode, responsive)
│   └── app.js           # Client-side JavaScript (modular, offline-ready)
├── worker/              # Cloudflare Worker backend
│   ├── worker.js        # Entry point — request routing
│   ├── routes.js        # API route handlers
│   └── db.js            # D1 database query helpers
├── schema.sql           # D1 SQL schema + seed data
├── wrangler.toml        # Cloudflare deployment config
├── package.json         # npm scripts
└── README.md            # This file
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v3+
- A Cloudflare account

---

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Create the D1 Database

```bash
npm run db:create
```

This prints a database ID. Copy it and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "maralyrics-db"
database_id = "PASTE_YOUR_DATABASE_ID_HERE"
```

### 4. Run Database Migration (Create Tables + Seed Data)

**Local development:**
```bash
npm run db:migrate:local
```

**Production (remote D1):**
```bash
npm run db:migrate
```

### 5. Start Local Development

```bash
npm run dev
```

Open [http://localhost:8787](http://localhost:8787) in your browser.

### 6. Deploy to Production

```bash
npm run deploy
```

---

## API Endpoints

| Method | Route                  | Description                    |
|--------|------------------------|--------------------------------|
| GET    | `/api/songs`           | List songs (paginated)         |
| GET    | `/api/song/:slug`      | Get single song by slug        |
| GET    | `/api/search?q=`       | Search by title or artist      |
| GET    | `/api/categories`      | Get all unique categories      |
| GET    | `/api/popular?limit=`  | Get top viewed songs           |
| POST   | `/api/view/:slug`      | Increment view count           |

### Query Parameters

- `page` — Page number (default: 1)
- `limit` — Items per page (default: 20, max: 50)
- `category` — Filter by category name
- `q` — Search query string

---

## Features

- **Glassmorphism UI** — Frosted glass cards, soft neon accents, dark mode
- **Real-time Search** — Debounced search with offline fallback
- **Smart Offline Cache** — Songs cached in localStorage + cookies for instant offline access
- **View Counter** — Per-song view tracking with 1-hour cooldown
- **Category Filters** — Filter songs by category with animated buttons
- **Pagination** — Clean paginated song listing
- **Shimmer Loading** — Skeleton loaders while fetching data
- **SEO Optimized** — Dynamic meta tags, Open Graph, JSON-LD structured data
- **Mobile-First** — Fully responsive, touch-friendly, no horizontal scroll
- **XSS Prevention** — Output sanitization, HTML escaping, input validation
- **Rate Limiting** — In-memory rate limiter for view count API

---

## Custom Domain (Optional)

In `wrangler.toml`, uncomment and update:

```toml
routes = [
  { pattern = "maralyrics.yourdomain.com", custom_domain = true }
]
```

Then deploy and configure DNS in Cloudflare dashboard.

---

## Adding Songs

Insert new songs directly into D1:

```sql
INSERT INTO songs (title, slug, artist, category, lyrics) VALUES
('Song Title', 'song-title-slug', 'Artist Name', 'Category', 'Lyrics line 1\nLine 2\n...');
```

Run via:
```bash
npx wrangler d1 execute maralyrics-db --command="INSERT INTO songs ..."
```

---

## License

MIT — Built with ♥ for the Mara community.
