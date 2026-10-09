# SEO guide — maralyrics.com

How search-engine optimisation is built into this project, how to verify it, and what still needs
a human with the right accounts. Nothing here guarantees rankings or indexing speed.

## How it works

The site is static HTML + `public/app.js` on **Cloudflare Pages**, with **Pages Functions** in
`functions/` and a Worker API on `api.maralyrics.com`.

| Concern | Where |
| --- | --- |
| Per-page `<title>`, description, canonical, Open Graph / Twitter tags | Static pages: in each `public/*.html`. Song / artist / composer / copyright-owner / article pages: injected on the server by `functions/<type>/[[catchall]].js` via `functions/_shared/seo.js` |
| Page content for crawlers | The same functions also fill the view shell with the real content (title, credited people as links, lyrics, bio, song lists, article body). `app.js` re-renders the same containers once it loads, so visitors see no change |
| Structured data (JSON-LD) | Home: `WebSite` (+ working `SearchAction`, `/?q=`) and `Organization`. Entity pages: `MusicRecording` / `MusicGroup` / `Person` / `Organization` / `Article` plus `BreadcrumbList`. Built from database fields only — no ratings, reviews or invented authors |
| 404s | Unknown slugs (and bare `/song/`, `/artist/`, …) return a real **404** with `noindex` and no canonical |
| Sitemap | `functions/sitemap.xml.js` → `/sitemap.xml`. Published songs/articles, plus artists, composers and copyright owners **that have at least one published song**. `<lastmod>` only where a real date exists |
| Crawl rules | `public/robots.txt`; `public/_headers` adds `X-Robots-Tag` for `/admin/*` and `/downloads` |
| Not indexed | `/admin/*` (login-protected), `/downloads` (per-device), `/report` (form), bare view shells, 404 page |
| Share image | `public/og-image.png` (1200×630). An artist/composer's own `https` image is used when they have one |

Deliberate choices:

* Titles/descriptions of entity pages stay **English** and are identical on the server and in
  `app.js`, so crawlers and browsers see the same text. Page *content* follows the visitor's language.
* `/report` and `/downloads` are **not** in `robots.txt`: Google can only honour `noindex` on a page it is
  allowed to crawl. `robots.txt` is not access control — the admin area is protected by login.
* `changefreq` / `priority` are omitted from the sitemap (Google ignores them) and there is no
  `keywords` meta tag.
* Structured data for copyright owners does not include their email address.

## Verify locally

```bash
npm run seo:check    # ~870 checks, no network, exits 1 on any failure
npm run i18n:check   # translation coverage
```

`seo:check` validates every page's title/description/canonical/social tags/headings/JSON-LD/images/internal
links, `robots.txt`, and **runs the real Pages Functions against an in-memory SQLite database built from
`schema.sql`** — status codes, canonicals, rendered content, JSON-LD, 404/`noindex`, draft content hidden,
and sitemap validity. It cannot check what only Google can tell you (see below).

## Manual steps (need your accounts)

1. **Deploy** the Pages site (push to the production branch). The `functions/` changes ship with it.
2. **Google Search Console** → add `https://maralyrics.com` as a *Domain* property (DNS TXT record at your
   registrar) or *URL-prefix* property (HTML tag / file).
3. **Sitemaps** → *Add a new sitemap* → `sitemap.xml` → Submit. Status should read *Success*; open
   `https://maralyrics.com/sitemap.xml` yourself first to confirm it loads.
4. **URL Inspection** → paste the home page, a song page, an artist page → *Test live URL* → check
   "URL is available to Google", the rendered HTML shows the content, and *Page indexing* has no `noindex`
   or "Blocked by robots.txt". Then *Request indexing* for a few key pages. (Requests are rate-limited and
   indexing is not instant or guaranteed.)
5. **Rich Results Test** (<https://search.google.com/test/rich-results>) on a song and an article URL —
   confirms the JSON-LD is parsed. Breadcrumb rich results appear only if Google chooses to show them.
6. **Bing Webmaster Tools** → import from Search Console or add the site and submit the same sitemap.
7. **Redirect `www` → apex** (if you serve `www.maralyrics.com`): Cloudflare → Rules → Redirect Rules → 301 to
   `https://maralyrics.com`. Keep one canonical host. Cloudflare Pages normally redirects `/page.html` → `/page` (confirm on the live site)
   and strips `/index.html`.
8. **Performance**: run <https://pagespeed.web.dev> on the home and a song page after deploy; Search Console's
   *Core Web Vitals* report fills in from real-user data after a few weeks.
9. **Worker deploy** (`npm run deploy`) is separate from Pages — it is not needed for SEO.

## Ongoing checklist

**Every change**
- [ ] `npm run seo:check` passes (CI-friendly: exit code 1 on failure).
- [ ] New public page → add it to `STATIC_PAGES` in `functions/sitemap.xml.js`, give it a unique title (≤ 70 chars),
      description (50–170 chars), canonical, one `<h1>`, the shared Open Graph/Twitter block, and a link from the footer or nav.
- [ ] New private/utility page → add `<meta name="robots" content="noindex, follow">` (do **not** Disallow it).
- [ ] New route handled by a Pages Function → return 404 (not an empty 200) for unknown slugs.
- [ ] Changed `app.js`/`style.css`/shell HTML → bump `CACHE_VERSION` in `public/sw.js`.
- [ ] Changed an entity page's title/description wording → change it in **both** the function and `app.js`.

**Monthly**
- [ ] Search Console → *Pages*: investigate "Crawled – not indexed", "Soft 404", "Duplicate without user-selected canonical".
- [ ] Search Console → *Sitemaps*: submitted vs discovered URL counts roughly match `/sitemap.xml`.
- [ ] Spot-check 3 random song pages with URL Inspection → *View crawled page*.
- [ ] Search Console → *Core Web Vitals* and *Experience*: no new "Poor" URL groups.

**When content grows**
- [ ] If `/sitemap.xml` approaches 50,000 URLs (or 50 MB), split into a sitemap index (the function logs a warning).
- [ ] Artists/composers/owners with no published songs stay out of the sitemap automatically; consider whether a
      long tail of near-empty profiles should also be `noindex`.

## Known limits / not verified here

* Nothing has been submitted to or verified by Google or Bing from this repository; indexing status is unknown
  until you check Search Console.
* Core Web Vitals / PageSpeed scores were not measured (needs a deployed URL and Lighthouse). The build has no
  minification step; `style.css` and `app.js` are served as written.
* Page `<title>`/description are English only; there are no per-language URLs (`hreflang`) because the language
  is a client-side setting on one URL.
