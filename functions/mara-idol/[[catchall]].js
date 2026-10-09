import {
  injectSeoMeta, seoResponse, notFoundResponse, escapeHtml, setInner, revealDetail, unhide,
  breadcrumbSchema, schemaGraph, toIso, linkList, idolResultChip, IDOL_RESULT_SEO, IDOL_RESULT_LABEL, SITE_ORIGIN,
} from '../_shared/seo.js';

// One Pages Function for every /mara-idol URL:
//   /mara-idol                 → the index page (a real, indexable page; list of seasons + idols filled in)
//   /mara-idol/:season         → a season (only if PUBLISHED, else a real 404 + noindex)
//   /mara-idol/:season/:idol   → one contestant (same rule)
// Title/description wording is identical to IdolSeasonPage/IdolProfilePage.updateMeta in public/app.js.

const enc = encodeURIComponent;
const httpsImage = (u) => (u && /^https:\/\//i.test(u) ? u : undefined);

function segments(pathname) {
  const parts = pathname.split('/').filter(Boolean).slice(1);
  try { return parts.map(decodeURIComponent); } catch { return null; } // malformed % escape → 404
}

async function shell(context, file) {
  const url = new URL(context.request.url);
  url.pathname = `/${file}`;
  return context.env.ASSETS.fetch(url);
}

// ── Index ────────────────────────────────────────────────────────────────────────
async function indexPage(context) {
  const res = await shell(context, 'mara-idol.html');
  const db = context.env.DB;
  const seasons = (await db.prepare(
    `SELECT title, slug, year FROM idol_seasons WHERE status = 'published' ORDER BY year DESC, start_date DESC, title COLLATE NOCASE`
  ).all()).results || [];
  let html = await res.text();
  // Crawlable links for every season; the full idol list lives on each season page.
  html = setInner(html, 'idolSeasonGrid', linkList(seasons.map((s) => ({ href: `/mara-idol/${enc(s.slug)}`, text: `${s.title} (${s.year})` }))));
  if (seasons.length) {
    html = html
      .replace('<section id="idolLoading" class="fade-in">', () => '<section id="idolLoading" class="fade-in" style="display:none;">')
      .replace('<section id="idolSeasonsSection" class="fade-in" style="display:none;">', () => '<section id="idolSeasonsSection" class="fade-in">');
  }
  return seoResponse(html);
}

// ── Season ───────────────────────────────────────────────────────────────────────
async function seasonPage(context, slug) {
  const res = await shell(context, 'idolseasonview.html');
  const db = context.env.DB;
  const season = await db.prepare(
    `SELECT id, title, slug, year, description, venue, start_date, end_date, cover_url, videos
     FROM idol_seasons WHERE slug = ? AND status = 'published'`
  ).bind(slug).first();
  if (!season) return notFoundResponse(res);
  const contestants = (await db.prepare(
    `SELECT c.name, c.slug, c.result, c.placement FROM idol_contestants c WHERE c.season_id = ?
     ORDER BY CASE c.result WHEN 'winner' THEN 0 WHEN 'runner_up' THEN 1 WHEN 'second_runner_up' THEN 2 WHEN 'finalist' THEN 3 WHEN 'semi_finalist' THEN 4 ELSE 5 END,
              CASE WHEN c.placement IS NULL THEN 1 ELSE 0 END, c.placement, c.sort_order, c.name COLLATE NOCASE`
  ).bind(season.id).all()).results || [];

  const url = `${SITE_ORIGIN}/mara-idol/${enc(season.slug)}`;
  const title = `${season.title} (${season.year}) — Mara Idol | MaraLyrics`;
  const text = String(season.description || '').replace(/\s+/g, ' ').trim();
  const description = text ? text.slice(0, 200) : `${season.title} — Mara Idol ${season.year} on MaraLyrics.`;

  const node = {
    '@type': season.start_date ? 'Event' : 'CollectionPage',
    '@id': `${url}#season`,
    name: season.title,
    url,
    ...(text ? { description: text.slice(0, 500) } : {}),
    ...(season.start_date ? { startDate: season.start_date } : {}),
    ...(season.end_date ? { endDate: season.end_date } : {}),
    ...(season.start_date && season.venue ? { location: { '@type': 'Place', name: season.venue } } : {}),
    ...(httpsImage(season.cover_url) ? { image: season.cover_url } : {}),
  };
  const crumbs = breadcrumbSchema([
    { name: 'Home', url: `${SITE_ORIGIN}/` },
    { name: 'Mara Idol', url: `${SITE_ORIGIN}/mara-idol` },
    { name: season.title },
  ]);

  let html = await res.text();
  html = revealDetail(html, { skeletonId: 'idolSkeletonBox', detailId: 'idolSeasonDetail' });
  html = setInner(html, 'breadcrumbName', escapeHtml(season.title));
  html = setInner(html, 'idolTitle', escapeHtml(season.title));
  html = setInner(html, 'idolYear', String(season.year));
  html = setInner(html, 'idolMeta', escapeHtml(season.venue || ''));
  if (text) {
    html = unhide(html, 'idolDescription');
    html = setInner(html, 'idolDescription', escapeHtml(season.description));
  }
  html = setInner(html, 'idolCount', `(${contestants.length})`);
  html = setInner(html, 'idolContestantGrid', linkList(contestants.map((c) => ({ href: `/mara-idol/${enc(season.slug)}/${enc(c.slug)}`, text: `${c.name}${c.result !== 'contestant' ? ` — ${IDOL_RESULT_LABEL[c.result]}` : ''}` }))));
  return seoResponse(injectSeoMeta(html, { title, description, url, image: season.cover_url, schema: schemaGraph(node, crumbs) }));
}

// ── Contestant ───────────────────────────────────────────────────────────────────
async function idolPage(context, seasonSlug, idolSlug) {
  const res = await shell(context, 'idolview.html');
  const db = context.env.DB;
  const row = await db.prepare(
    `SELECT c.name, c.slug, c.bio, c.photo_url, c.result, c.placement, c.artist_id,
            s.title AS season_title, s.slug AS season_slug, s.year AS season_year
     FROM idol_contestants c JOIN idol_seasons s ON s.id = c.season_id AND s.status = 'published'
     WHERE s.slug = ? AND c.slug = ?`
  ).bind(seasonSlug, idolSlug).first();
  if (!row) return notFoundResponse(res);
  const artist = row.artist_id ? await db.prepare('SELECT name, slug FROM artists WHERE id = ?').bind(row.artist_id).first() : null;

  const seasonUrl = `${SITE_ORIGIN}/mara-idol/${enc(row.season_slug)}`;
  const url = `${seasonUrl}/${enc(row.slug)}`;
  const title = `${row.name} — ${row.season_title} | Mara Idol | MaraLyrics`;
  const lead = row.result === 'contestant'
    ? `${row.name} — contestant in ${row.season_title} (${row.season_year}), Mara Idol.`
    : `${row.name} — ${IDOL_RESULT_SEO[row.result]} of ${row.season_title} (${row.season_year}), Mara Idol.`;
  const description = `${lead}${row.bio ? ` ${row.bio}` : ''}`.slice(0, 300);

  const node = {
    '@type': 'Person',
    '@id': `${url}#idol`,
    name: row.name,
    url,
    ...(httpsImage(row.photo_url) ? { image: row.photo_url } : {}),
    ...(row.bio ? { description: row.bio.slice(0, 500) } : {}),
    // Only a real result the admins recorded — never invented.
    ...(row.result !== 'contestant' ? { award: `${IDOL_RESULT_LABEL[row.result]} — ${row.season_title}` } : {}),
    ...(artist ? { sameAs: [`${SITE_ORIGIN}/artist/${enc(artist.slug)}`] } : {}),
  };
  const crumbs = breadcrumbSchema([
    { name: 'Home', url: `${SITE_ORIGIN}/` },
    { name: 'Mara Idol', url: `${SITE_ORIGIN}/mara-idol` },
    { name: row.season_title, url: seasonUrl },
    { name: row.name },
  ]);

  let html = await res.text();
  html = revealDetail(html, { skeletonId: 'idolSkeletonBox', detailId: 'idolDetail' });
  html = setInner(html, 'breadcrumbName', escapeHtml(row.name));
  const seasonHref = `/mara-idol/${enc(row.season_slug)}`;
  html = html
    .replace(/<a href="\/mara-idol" class="breadcrumb__link" id="breadcrumbSeason">[^<]*<\/a>/, () => `<a href="${seasonHref}" class="breadcrumb__link" id="breadcrumbSeason">${escapeHtml(row.season_title)}</a>`)
    .replace('<a id="idolSeasonLink" class="meta-link" href="/mara-idol"></a>', () => `<a id="idolSeasonLink" class="meta-link" href="${seasonHref}">${escapeHtml(`${row.season_title} · ${row.season_year}`)}</a>`);
  html = setInner(html, 'idolName', escapeHtml(row.name));
  html = setInner(html, 'idolTags', idolResultChip(row.result, row.placement, true));
  html = setInner(html, 'idolAvatarFallback', escapeHtml((row.name || '?').charAt(0)));
  if (row.bio) {
    html = unhide(html, 'idolBio');
    html = setInner(html, 'idolBio', escapeHtml(row.bio));
  }
  return seoResponse(injectSeoMeta(html, { title, description, url, image: row.photo_url, schema: schemaGraph(node, crumbs) }));
}

export async function onRequest(context) {
  const parts = segments(new URL(context.request.url).pathname);
  if (!parts) return notFoundResponse(await shell(context, 'mara-idol.html'));
  if (parts.length === 0) return indexPage(context);
  if (parts.length === 1) return seasonPage(context, parts[0]);
  if (parts.length === 2) return idolPage(context, parts[0], parts[1]);
  return notFoundResponse(await shell(context, 'mara-idol.html'));
}
