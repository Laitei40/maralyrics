// Fuzzy "did you mean" suggestions for the search box — used when a strict full-text
// match finds nothing, e.g. a user typing a remembered lyric line ("Martha nah Mari
// Zisu aw ei") that doesn't literally appear as a contiguous phrase anywhere, but whose
// individual words do appear (scattered through the lyrics) in a specific song.

/** Lowercases and strips combining diacritics so accented characters match their base form. */
function normalize(str) {
  return String(str || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip combining diacritical marks left behind by NFKD
    .toLowerCase();
}

/** Splits normalized text into word tokens (letters/numbers only). */
function tokenize(str) {
  return normalize(str).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Builds an FTS5 MATCH string that ORs every query word as a prefix match, so a row
 * is returned if it contains ANY of the words — a much wider net than the default
 * (implicit AND) query, used to gather fuzzy-match candidates.
 */
export function buildOrPrefixQuery(query) {
  const words = tokenize(query);
  if (!words.length) return null;
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' OR ');
}

/**
 * Scores how well `candidateText` (typically a song's title + lyrics) matches the
 * search query, as the percentage of the query's distinct words found — as a whole
 * word or a substring — anywhere in the candidate text. Returns an integer 0-100.
 */
export function matchPercent(query, candidateText) {
  const queryWords = [...new Set(tokenize(query))];
  if (!queryWords.length) return 0;

  const candidateNormalized = normalize(candidateText);
  const candidateWords = new Set(tokenize(candidateText));

  let matched = 0;
  for (const word of queryWords) {
    if (candidateWords.has(word) || candidateNormalized.includes(word)) matched++;
  }
  return Math.round((matched / queryWords.length) * 100);
}
