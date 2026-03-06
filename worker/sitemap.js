const BASE_URL = 'https://maralyrics.com';
const MAX_URLS_PER_SITEMAP = 50000;

const timestampColumnCache = new Map();

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slugifyCategory(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatDate(dateValue) {
  if (!dateValue) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function xmlResponse(xml) {
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=UTF-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

function buildUrlSetXml(entries) {
  const items = entries
    .map((entry) => `  <url>\n    <loc>${xmlEscape(entry.loc)}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`;
}

function buildIndexXml(sitemaps) {
  const items = sitemaps
    .map((entry) => `  <sitemap>\n    <loc>${xmlEscape(entry.loc)}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n  </sitemap>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>`;
}

function chunkEntries(entries, size) {
  const chunks = [];
  for (let i = 0; i < entries.length; i += size) {
    chunks.push(entries.slice(i, i + size));
  }
  return chunks;
}

async function resolveTimestampColumn(db, tableName) {
  if (timestampColumnCache.has(tableName)) {
    return timestampColumnCache.get(tableName);
  }

  const pragma = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  const columnNames = new Set((pragma.results || []).map((col) => col.name));
  const column = columnNames.has('updated_at') ? 'updated_at' : 'created_at';
  timestampColumnCache.set(tableName, column);
  return column;
}

async function fetchEntities(db, tableName, pathPrefix, changefreq, priority) {
  const timestampColumn = await resolveTimestampColumn(db, tableName);
  const query = `SELECT slug, ${timestampColumn} AS lastmod FROM ${tableName} WHERE slug IS NOT NULL ORDER BY id DESC`;
  const rows = await db.prepare(query).all().then((r) => r.results || []);

  return rows
    .filter((row) => row.slug)
    .map((row) => ({
      loc: `${BASE_URL}/${pathPrefix}/${row.slug}`,
      lastmod: formatDate(row.lastmod),
      changefreq,
      priority,
    }));
}

async function fetchCategoryEntries(db) {
  const timestampColumn = await resolveTimestampColumn(db, 'songs');
  const query = `
    SELECT category, MAX(${timestampColumn}) AS lastmod
    FROM songs
    WHERE category IS NOT NULL AND TRIM(category) != ''
    GROUP BY category
    ORDER BY category ASC
  `;

  const rows = await db.prepare(query).all().then((r) => r.results || []);

  return rows
    .map((row) => ({ slug: slugifyCategory(row.category), lastmod: row.lastmod }))
    .filter((row) => row.slug)
    .map((row) => ({
      loc: `${BASE_URL}/category/${row.slug}`,
      lastmod: formatDate(row.lastmod),
      changefreq: 'weekly',
      priority: '0.8',
    }));
}

async function buildSitemapEntries(db) {
  const [songs, artists, composers, categories] = await Promise.all([
    fetchEntities(db, 'songs', 'song', 'monthly', '0.7'),
    fetchEntities(db, 'artists', 'artist', 'weekly', '0.6'),
    fetchEntities(db, 'composers', 'composer', 'weekly', '0.6'),
    fetchCategoryEntries(db),
  ]);

  const latestDate = [
    ...songs,
    ...artists,
    ...composers,
    ...categories,
  ].reduce((latest, entry) => (entry.lastmod > latest ? entry.lastmod : latest), formatDate(new Date()));

  return [
    {
      loc: `${BASE_URL}/`,
      lastmod: latestDate,
      changefreq: 'daily',
      priority: '1.0',
    },
    ...songs,
    ...artists,
    ...composers,
    ...categories,
  ];
}

export async function handleSitemap(request, db) {
  const url = new URL(request.url);
  const path = url.pathname;

  const entries = await buildSitemapEntries(db);

  const chunkMatch = path.match(/^\/sitemap-(\d+)\.xml$/);
  const chunks = chunkEntries(entries, MAX_URLS_PER_SITEMAP);

  if (chunkMatch) {
    const index = parseInt(chunkMatch[1], 10) - 1;
    if (index < 0 || index >= chunks.length) {
      return new Response('Sitemap not found', { status: 404 });
    }
    return xmlResponse(buildUrlSetXml(chunks[index]));
  }

  if (entries.length <= MAX_URLS_PER_SITEMAP) {
    return xmlResponse(buildUrlSetXml(entries));
  }

  const sitemapIndexEntries = chunks.map((chunk, index) => {
    const latestChunkDate = chunk.reduce(
      (latest, entry) => (entry.lastmod > latest ? entry.lastmod : latest),
      formatDate(new Date())
    );

    return {
      loc: `${BASE_URL}/sitemap-${index + 1}.xml`,
      lastmod: latestChunkDate,
    };
  });

  return xmlResponse(buildIndexXml(sitemapIndexEntries));
}
