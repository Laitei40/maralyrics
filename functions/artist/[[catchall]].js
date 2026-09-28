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

function buildArtistSeo(artist, songCount) {
  const title = `${artist.name} — Mara Artist Lyrics & Songs | MaraLyrics`;
  const countText = songCount === 1 ? '1 song' : `${songCount} songs`;
  const bio = artist.bio ? ` ${artist.bio}` : '';
  const description = `Explore ${countText} by ${artist.name} on MaraLyrics.${bio}`.trim().slice(0, 300);
  const url = `https://maralyrics.com/artist/${artist.slug}`;
  const sameAs = parseSocialLinks(artist.social_links);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'MusicGroup',
    name: artist.name,
    url,
    ...(artist.image_url ? { image: artist.image_url } : {}),
    ...(sameAs ? { sameAs } : {}),
  };

  return { title, description, url, schema };
}

async function fetchArtist(db, slug) {
  const artist = await db.prepare('SELECT * FROM artists WHERE slug = ?').bind(slug).first();
  if (!artist) return null;

  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM song_artists sa
       JOIN songs s ON s.id = sa.song_id
       WHERE sa.artist_id = ? AND s.status = 'published'`
    )
    .bind(artist.id)
    .first();

  return { artist, songCount: countRow.count };
}

// Catch-all Pages Function for /artist/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = requestUrl.pathname.replace(/^\/artist\//, '').replace(/\/$/, '');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/artistview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  if (!slug) return assetResponse;

  const result = await fetchArtist(context.env.DB, slug);
  if (!result) return notFoundResponse(assetResponse);

  const html = await assetResponse.text();
  const seo = buildArtistSeo(result.artist, result.songCount);
  return seoResponse(injectSeoMeta(html, seo));
}
