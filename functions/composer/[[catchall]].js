import { injectSeoMeta, seoResponse, notFoundResponse, isSafeUrl } from '../_shared/seo.js';

function parseSocialLinks(raw) {
  if (!raw) return undefined;
  try {
    const links = JSON.parse(raw);
    if (!Array.isArray(links)) return undefined;
    const safe = links.filter(isSafeUrl);
    return safe.length ? safe : undefined;
  } catch {
    return undefined;
  }
}

function buildComposerSeo(composer, songCount) {
  const title = `${composer.name} — Mara Composer | MaraLyrics`;
  const countText = songCount === 1 ? '1 song' : `${songCount} songs`;
  const bio = composer.bio ? ` ${composer.bio}` : '';
  const description = `Explore ${countText} composed by ${composer.name} on MaraLyrics.${bio}`.trim().slice(0, 300);
  const url = `https://maralyrics.com/composer/${composer.slug}`;
  const sameAs = parseSocialLinks(composer.social_links);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: composer.name,
    url,
    ...(composer.image_url ? { image: composer.image_url } : {}),
    ...(sameAs ? { sameAs } : {}),
  };

  return { title, description, url, schema };
}

async function fetchComposer(db, slug) {
  const composer = await db.prepare('SELECT * FROM composers WHERE slug = ?').bind(slug).first();
  if (!composer) return null;

  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM song_composers sc
       JOIN songs s ON s.id = sc.song_id
       WHERE sc.composer_id = ? AND s.status = 'published'`
    )
    .bind(composer.id)
    .first();

  return { composer, songCount: countRow.count };
}

// Catch-all Pages Function for /composer/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = requestUrl.pathname.replace(/^\/composer\//, '').replace(/\/$/, '');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/composerview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  if (!slug) return assetResponse;

  const result = await fetchComposer(context.env.DB, slug);
  if (!result) return notFoundResponse(assetResponse);

  const html = await assetResponse.text();
  const seo = buildComposerSeo(result.composer, result.songCount);
  return seoResponse(injectSeoMeta(html, seo));
}
