import { injectSeoMeta, seoResponse, notFoundResponse } from '../_shared/seo.js';

function buildSongSeo(song) {
  const title = `${song.title} Lyrics – Mara Song | MaraLyrics`;
  const artist = song.artist_name || 'Unknown Artist';
  const description = `Read the full lyrics of ${song.title}, a Mara song by ${artist}. Discover Mara music on MaraLyrics.`;
  const url = `https://maralyrics.com/song/${song.slug}`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'MusicRecording',
    name: song.title,
    byArtist: {
      '@type': 'MusicGroup',
      name: artist,
    },
    inLanguage: 'mrh',
    url,
    publisher: {
      '@type': 'Organization',
      name: 'MaraLyrics',
    },
  };

  return { title, description, url, schema };
}

async function fetchSong(db, slug) {
  return db
    .prepare(
      `SELECT s.title, s.slug,
         (SELECT GROUP_CONCAT(name, ', ') FROM (
            SELECT a.name AS name FROM song_artists sa JOIN artists a ON a.id = sa.artist_id
            WHERE sa.song_id = s.id ORDER BY sa.position
          )) AS artist_name
       FROM songs s
       WHERE s.slug = ? AND s.status = 'published'`
    )
    .bind(slug)
    .first();
}

// Catch-all Pages Function for /song/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = requestUrl.pathname.replace(/^\/song\//, '').replace(/\/$/, '');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/songview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  if (!slug) return assetResponse;

  const song = await fetchSong(context.env.DB, slug);
  if (!song) return notFoundResponse(assetResponse);

  const html = await assetResponse.text();
  const seo = buildSongSeo(song);
  return seoResponse(injectSeoMeta(html, seo));
}
