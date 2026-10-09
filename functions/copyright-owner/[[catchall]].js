import {
  injectSeoMeta, seoResponse, notFoundResponse, escapeHtml, setInner, revealDetail,
  songLinkList, breadcrumbSchema, schemaGraph, slugFromPath, isSafeUrl, SITE_ORIGIN,
} from '../_shared/seo.js';

// Title/description are kept byte-identical to CopyrightOwnerPage.updateMeta in public/app.js.
function buildOwnerSeo(owner, songs) {
  const songCount = songs.length;
  const title = `${owner.name} — Copyright Owner | MaraLyrics`;
  const countText = songCount === 1 ? '1 song' : `${songCount} songs`;
  const org = owner.organization ? ` (${owner.organization})` : '';
  const description = `${countText} claimed by ${owner.name}${org} on MaraLyrics.`.trim().slice(0, 300);
  const url = `${SITE_ORIGIN}/copyright-owner/${encodeURIComponent(owner.slug)}`;

  // Deliberately no `email` here: structured data is machine-harvested, and the contact
  // address adds nothing a search result needs (it stays on the page for people who want it).
  const entity = {
    '@type': 'Organization',
    '@id': `${url}#owner`,
    name: owner.organization || owner.name,
    url,
    ...(owner.website && isSafeUrl(owner.website) && /^https?:/i.test(owner.website) ? { sameAs: [owner.website] } : {}),
  };
  const crumbs = breadcrumbSchema([
    { name: 'Home', url: `${SITE_ORIGIN}/` },
    { name: owner.name },
  ]);

  return { title, description, url, schema: schemaGraph(entity, crumbs) };
}

async function fetchOwner(db, slug) {
  const owner = await db.prepare('SELECT * FROM copyright_owners WHERE slug = ?').bind(slug).first();
  if (!owner) return null;

  const rows = await db
    .prepare("SELECT title, slug FROM songs WHERE copyright_owner_id = ? AND status = 'published' ORDER BY title")
    .bind(owner.id)
    .all();

  return { owner, songs: rows.results || [] };
}

// Real content for crawlers that don't execute JS; app.js re-renders the same containers.
function renderOwnerPage(html, owner, songs) {
  let out = html;
  out = revealDetail(out, { skeletonId: 'profileSkeleton', detailId: 'profileDetail' });
  out = setInner(out, 'profileName', escapeHtml(owner.name));
  out = setInner(out, 'breadcrumbName', escapeHtml(owner.name));
  out = setInner(out, 'songCount', `(${songs.length})`);
  out = setInner(out, 'profileSongGrid', songLinkList(songs));
  return out;
}

// Catch-all Pages Function for /copyright-owner/* routes.
export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = slugFromPath(requestUrl.pathname, 'copyright-owner');

  const assetUrl = new URL(context.request.url);
  assetUrl.pathname = '/copyrightownerview.html';
  const assetResponse = await context.env.ASSETS.fetch(assetUrl);

  // "/copyright-owner/" with no slug is not a page — a real 404, not a 200 empty shell.
  if (!slug) return notFoundResponse(assetResponse);

  const result = await fetchOwner(context.env.DB, slug);
  if (!result) return notFoundResponse(assetResponse);

  const html = await assetResponse.text();
  return seoResponse(injectSeoMeta(renderOwnerPage(html, result.owner, result.songs), buildOwnerSeo(result.owner, result.songs)));
}
