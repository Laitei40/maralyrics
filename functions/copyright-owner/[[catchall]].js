import { injectSeoMeta, seoResponse, notFoundResponse, isSafeUrl } from '../_shared/seo.js';

function buildOwnerSeo(owner, songCount) {
  const title = `${owner.name} — Copyright Owner | MaraLyrics`;
  const countText = songCount === 1 ? '1 song' : `${songCount} songs`;
  const org = owner.organization ? ` (${owner.organization})` : '';
  const description = `${countText} claimed by ${owner.name}${org} on MaraLyrics.`.trim().slice(0, 300);
  const url = `https://maralyrics.com/copyright-owner/${owner.slug}`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: owner.organization || owner.name,
    url,
    ...(owner.website && isSafeUrl(owner.website) ? { sameAs: [owner.website] } : {}),
    ...(owner.email ? { email: owner.email } : {}),
  };

  return { title, description, url, schema };
}

async function fetchOwner(db, slug) {
  const owner = await db.prepare('SELECT * FROM copyright_owners WHERE slug = ?').bind(slug).first();
  if (!owner) return null;

  const countRow = await db
    .prepare("SELECT COUNT(*) AS count FROM songs WHERE copyright_owner_id = ? AND status = 'published'")
    .bind(owner.id)
    .first();

  return { owner, songCount: countRow.count };
}

// Catch-all Pages Function for /copyright-owner/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = requestUrl.pathname.replace(/^\/copyright-owner\//, '').replace(/\/$/, '');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/copyrightownerview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  if (!slug) return assetResponse;

  const result = await fetchOwner(context.env.DB, slug);
  if (!result) return notFoundResponse(assetResponse);

  const html = await assetResponse.text();
  const seo = buildOwnerSeo(result.owner, result.songCount);
  return seoResponse(injectSeoMeta(html, seo));
}
