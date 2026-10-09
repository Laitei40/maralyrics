import {
  injectSeoMeta, seoResponse, notFoundResponse, escapeHtml, setInner, revealDetail, unhide,
  songLinkList, breadcrumbSchema, schemaGraph, slugFromPath, isSafeUrl, SITE_ORIGIN,
} from '../_shared/seo.js';

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

// Title/description are kept byte-identical to ProfilePage.updateMeta in public/app.js.
function buildArtistSeo(artist, songs) {
  const songCount = songs.length;
  const title = `${artist.name} — Mara Artist Lyrics & Songs | MaraLyrics`;
  const countText = songCount === 1 ? '1 song' : `${songCount} songs`;
  const bio = artist.bio ? ` ${artist.bio}` : '';
  const description = `Explore ${countText} by ${artist.name} on MaraLyrics.${bio}`.trim().slice(0, 300);
  const url = `${SITE_ORIGIN}/artist/${encodeURIComponent(artist.slug)}`;
  const sameAs = parseSocialLinks(artist.social_links);

  const entity = {
    '@type': 'MusicGroup',
    '@id': `${url}#artist`,
    name: artist.name,
    url,
    ...(artist.image_url && /^https:\/\//i.test(artist.image_url) ? { image: artist.image_url } : {}),
    ...(sameAs ? { sameAs } : {}),
  };
  const crumbs = breadcrumbSchema([
    { name: 'Home', url: `${SITE_ORIGIN}/` },
    { name: 'Artists & Composers', url: `${SITE_ORIGIN}/artists-composers` },
    { name: artist.name },
  ]);

  return { title, description, url, image: artist.image_url, schema: schemaGraph(entity, crumbs) };
}

async function fetchArtist(db, slug) {
  const artist = await db.prepare('SELECT * FROM artists WHERE slug = ?').bind(slug).first();
  if (!artist) return null;
  const songs = await fetchSongsFor(db, 'song_artists', 'artist_id', artist.id);
  return { artist, songs };
}

async function fetchSongsFor(db, junction, fk, id) {
  const rows = await db
    .prepare(
      `SELECT s.title AS title, s.slug AS slug FROM ${junction} j
       JOIN songs s ON s.id = j.song_id
       WHERE j.${fk} = ? AND s.status = 'published' ORDER BY s.title`
    )
    .bind(id)
    .all();
  return rows.results || [];
}

// Real content for crawlers that don't execute JS; app.js re-renders the same containers.
function renderArtistPage(html, artist, songs) {
  let out = html;
  out = revealDetail(out, { skeletonId: 'profileSkeleton', detailId: 'profileDetail' });
  out = setInner(out, 'profileName', escapeHtml(artist.name));
  out = setInner(out, 'breadcrumbName', escapeHtml(artist.name));
  out = setInner(out, 'avatarFallback', escapeHtml((artist.name || '?').charAt(0)));
  if (artist.bio) out = setInner(out, 'profileBio', escapeHtml(artist.bio));
  out = setInner(out, 'songCount', `(${songs.length})`);
  out = setInner(out, 'profileSongGrid', songLinkList(songs));
  return out;
}

// Catch-all Pages Function for /artist/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = slugFromPath(requestUrl.pathname, 'artist');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/artistview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  // "/artist/" with no slug is not a page — a real 404, not a 200 empty shell.
  if (!slug) return notFoundResponse(assetResponse);

  const result = await fetchArtist(context.env.DB, slug);
  if (!result) return notFoundResponse(assetResponse);

  const html = await assetResponse.text();
  const seo = buildArtistSeo(result.artist, result.songs);
  return seoResponse(injectSeoMeta(renderArtistPage(html, result.artist, result.songs), seo));
}
