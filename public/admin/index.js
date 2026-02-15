// ┌───────────────────────────────────────────────┐
// │        MaraLyrics — Admin Dashboard Logic     │
// └───────────────────────────────────────────────┘

'use strict';

const WORKER_ORIGIN = 'https://maralyrics.teiteipara.workers.dev';
const IS_PAGES = window.location.hostname.endsWith('pages.dev') || window.location.hostname.endsWith('maralyrics.com');
const API_ORIGIN = IS_PAGES ? WORKER_ORIGIN : '';
const ADMIN_API = `${API_ORIGIN}/api/admin`;

// State
let currentPage = 1;
let totalPages = 1;
let allSongs = [];
let allArtists = [];
let allComposers = [];
let deleteTargetId = null;
let deleteTargetType = 'song'; // 'song' | 'artist' | 'composer' | 'report'
let allReports = [];
let allCopyrightOwners = [];

// Helpers
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatViews(n) {
  if (!n || n < 1000) return String(n || 0);
  if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

function generateSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── API Calls ──────────────────────────────────
async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status}`);
  }
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function apiPut(url, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function apiDelete(url) {
  const res = await fetch(url, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ─── Tab Switching ──────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.admin__tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.admin__panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('panel' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (panel) panel.style.display = 'block';

  if (tab === 'artists') loadArtists();
  if (tab === 'composers') loadComposers();
  if (tab === 'reports') loadReports();
  if (tab === 'copyright-owners') loadCopyrightOwners();
}

// ─── Populate Artist/Composer Dropdowns ─────────
async function populateDropdowns() {
  try {
    const [aData, cData, coData] = await Promise.all([
      apiGet(`${ADMIN_API}/artists`),
      apiGet(`${ADMIN_API}/composers`),
      apiGet(`${ADMIN_API}/copyright-owners`),
    ]);
    allArtists = aData.artists || [];
    allComposers = cData.composers || [];
    allCopyrightOwners = coData.copyright_owners || [];
  } catch (err) {
    console.warn('Failed to load dropdowns:', err);
  }

  const artistSel = document.getElementById('formArtist');
  const composerSel = document.getElementById('formComposer');
  const coSel = document.getElementById('formCopyrightOwner');

  if (artistSel) {
    artistSel.innerHTML = '<option value="">— None —</option>' +
      allArtists.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  }
  if (composerSel) {
    composerSel.innerHTML = '<option value="">— None —</option>' +
      allComposers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }
  if (coSel) {
    coSel.innerHTML = '<option value="">— None —</option>' +
      allCopyrightOwners.map(co => `<option value="${co.id}">${escapeHtml(co.name)}</option>`).join('');
  }
}

// ═══════════════════════════════════════════════════
// ═══ SONGS ════════════════════════════════════════
// ═══════════════════════════════════════════════════

async function loadSongs(page = 1) {
  const tbody = document.getElementById('songsTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="admin-table__empty">Loading...</td></tr>';

  try {
    const data = await apiGet(`${ADMIN_API}/songs?page=${page}&limit=50`);
    allSongs = data.songs || [];
    currentPage = data.page;
    totalPages = data.totalPages;

    renderSongsTable(allSongs);
    renderPagination();
    updateStats(data);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="admin-table__empty" style="color:var(--danger);">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderSongsTable(songs) {
  const tbody = document.getElementById('songsTableBody');

  if (!songs.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="admin-table__empty">No songs found. Click "+ New Song" to add one.</td></tr>';
    return;
  }

  tbody.innerHTML = songs.map((song) => `
    <tr data-id="${song.id}">
      <td>
        <div class="admin-table__title">${escapeHtml(song.title)}</div>
        <div class="admin-table__slug">/song/${escapeHtml(song.slug)}</div>
      </td>
      <td>${escapeHtml(song.artist_name || song.artist || '—')}</td>
      <td>${escapeHtml(song.composer_name || song.composer || '—')}</td>
      <td>${song.category ? `<span class="song-card__category">${escapeHtml(song.category)}</span>` : '—'}</td>
      <td>${formatViews(song.views)}</td>
      <td>${formatDate(song.created_at)}</td>
      <td>
        <div class="admin-table__actions">
          <button class="btn btn--sm btn--ghost" onclick="editSong(${song.id})" title="Edit">✏️</button>
          <button class="btn btn--sm btn--ghost btn--danger-text" onclick="confirmDelete(${song.id}, '${escapeHtml(song.title).replace(/'/g, "\\'")}', 'song')" title="Delete">🗑️</button>
          <a href="../song/${escapeHtml(song.slug)}" target="_blank" class="btn btn--sm btn--ghost" title="View">👁️</a>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderPagination() {
  const el = document.getElementById('adminPagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = `<button class="pagination__btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="loadSongs(${currentPage - 1})">← Prev</button>`;
  html += `<span class="pagination__info">Page ${currentPage} of ${totalPages}</span>`;
  html += `<button class="pagination__btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="loadSongs(${currentPage + 1})">Next →</button>`;
  el.innerHTML = html;
}

async function updateStats(data) {
  document.getElementById('statTotal').textContent = data.total || allSongs.length;
  try {
    const catData = await apiGet(`${API_ORIGIN}/api/categories`);
    document.getElementById('statCategories').textContent = catData.categories?.length || 0;
  } catch { /* ignore */ }
  const totalViews = allSongs.reduce((sum, s) => sum + (s.views || 0), 0);
  document.getElementById('statViews').textContent = formatViews(totalViews);
}

function filterSongs(query) {
  const q = query.toLowerCase().trim();
  if (!q) { renderSongsTable(allSongs); return; }
  const filtered = allSongs.filter(
    (s) =>
      s.title?.toLowerCase().includes(q) ||
      (s.artist_name || s.artist || '').toLowerCase().includes(q) ||
      (s.composer_name || s.composer || '').toLowerCase().includes(q) ||
      s.category?.toLowerCase().includes(q)
  );
  renderSongsTable(filtered);
}

// Song Modal
function openSongModal() {
  document.getElementById('songModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeSongModal() {
  document.getElementById('songModal').style.display = 'none';
  document.body.style.overflow = '';
  clearSongForm();
}
function clearSongForm() {
  document.getElementById('songForm').reset();
  document.getElementById('formSongId').value = '';
  document.getElementById('formMessage').style.display = 'none';
}
function showFormMessage(text, isError = false) {
  const el = document.getElementById('formMessage');
  el.textContent = text;
  el.className = 'form-message ' + (isError ? 'form-message--error' : 'form-message--success');
  el.style.display = 'block';
}

function openNewSong() {
  clearSongForm();
  document.getElementById('modalTitle').textContent = 'New Song';
  document.getElementById('btnSubmit').textContent = 'Create Song';
  populateDropdowns();
  openSongModal();
  document.getElementById('formTitle').focus();
}

async function editSong(id) {
  clearSongForm();
  document.getElementById('modalTitle').textContent = 'Edit Song';
  document.getElementById('btnSubmit').textContent = 'Update Song';
  await populateDropdowns();
  openSongModal();

  try {
    const song = await apiGet(`${ADMIN_API}/song/${id}`);
    document.getElementById('formSongId').value = song.id;
    document.getElementById('formTitle').value = song.title || '';
    document.getElementById('formArtist').value = song.artist_id || '';
    document.getElementById('formComposer').value = song.composer_id || '';
    document.getElementById('formCategory').value = song.category || '';
    document.getElementById('formCopyrightOwner').value = song.copyright_owner_id || '';
    document.getElementById('formSlug').value = song.slug || '';
    document.getElementById('formLyrics').value = song.lyrics || '';
  } catch (err) {
    showFormMessage('Failed to load song: ' + err.message, true);
  }
}

async function saveSong(e) {
  e.preventDefault();

  const id = document.getElementById('formSongId').value;
  const title = document.getElementById('formTitle').value.trim();
  const artist_id = document.getElementById('formArtist').value || null;
  const composer_id = document.getElementById('formComposer').value || null;
  const copyright_owner_id = document.getElementById('formCopyrightOwner').value || null;
  const category = document.getElementById('formCategory').value.trim();
  const slug = document.getElementById('formSlug').value.trim();
  const lyrics = document.getElementById('formLyrics').value.trim();

  if (!title) { showFormMessage('Title is required.', true); return; }
  if (!lyrics) { showFormMessage('Lyrics are required.', true); return; }

  const btn = document.getElementById('btnSubmit');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const body = { title, artist_id, composer_id, copyright_owner_id, category, slug, lyrics };

    if (id) {
      await apiPut(`${ADMIN_API}/song/${id}`, body);
      showFormMessage('Song updated successfully!');
    } else {
      await apiPost(`${ADMIN_API}/songs`, body);
      showFormMessage('Song created successfully!');
    }

    setTimeout(() => {
      closeSongModal();
      loadSongs(currentPage);
    }, 800);
  } catch (err) {
    showFormMessage(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = id ? 'Update Song' : 'Create Song';
  }
}

// Auto-slug for songs
function autoSongSlug() {
  const slugField = document.getElementById('formSlug');
  const titleField = document.getElementById('formTitle');
  if (!slugField.dataset.manual) {
    slugField.value = generateSlug(titleField.value);
  }
}

// ═══════════════════════════════════════════════════
// ═══ ARTISTS / COMPOSERS ══════════════════════════
// ═══════════════════════════════════════════════════

async function loadArtists() {
  const tbody = document.getElementById('artistsTableBody');
  tbody.innerHTML = '<tr><td colspan="4" class="admin-table__empty">Loading...</td></tr>';
  try {
    const data = await apiGet(`${ADMIN_API}/artists`);
    allArtists = data.artists || [];
    renderPersonTable('artist', allArtists, tbody);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="admin-table__empty" style="color:var(--danger);">Failed: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function loadComposers() {
  const tbody = document.getElementById('composersTableBody');
  tbody.innerHTML = '<tr><td colspan="4" class="admin-table__empty">Loading...</td></tr>';
  try {
    const data = await apiGet(`${ADMIN_API}/composers`);
    allComposers = data.composers || [];
    renderPersonTable('composer', allComposers, tbody);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="admin-table__empty" style="color:var(--danger);">Failed: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderPersonTable(type, items, tbody) {
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="admin-table__empty">No ${type}s found.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(item => `
    <tr data-id="${item.id}">
      <td><div class="admin-table__title">${escapeHtml(item.name)}</div></td>
      <td><div class="admin-table__slug">/${type}/${escapeHtml(item.slug)}</div></td>
      <td>${escapeHtml((item.bio || '').substring(0, 60))}${item.bio && item.bio.length > 60 ? '...' : ''}</td>
      <td>
        <div class="admin-table__actions">
          <button class="btn btn--sm btn--ghost" onclick="editPerson('${type}', ${item.id})" title="Edit">✏️</button>
          <button class="btn btn--sm btn--ghost btn--danger-text" onclick="confirmDelete(${item.id}, '${escapeHtml(item.name).replace(/'/g, "\\'")}', '${type}')" title="Delete">🗑️</button>
          <a href="../${type}/${escapeHtml(item.slug)}" target="_blank" class="btn btn--sm btn--ghost" title="View">👁️</a>
        </div>
      </td>
    </tr>
  `).join('');
}

// ─── Social Link Helpers ────────────────────────
const SOCIAL_PLATFORMS = [
  { pattern: /facebook\.com|fb\.com/i,    name: 'Facebook',  icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' },
  { pattern: /twitter\.com|x\.com/i,      name: 'X',         icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
  { pattern: /instagram\.com/i,           name: 'Instagram', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>' },
  { pattern: /youtube\.com|youtu\.be/i,   name: 'YouTube',   icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>' },
  { pattern: /tiktok\.com/i,              name: 'TikTok',    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>' },
  { pattern: /spotify\.com/i,             name: 'Spotify',   icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>' },
  { pattern: /soundcloud\.com/i,          name: 'SoundCloud', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c-.009-.06-.05-.1-.1-.1zm-.899.828c-.06 0-.091.037-.104.094L0 14.479l.172 1.282c.013.06.045.094.104.094.057 0 .09-.037.104-.094l.199-1.282-.199-1.332c-.014-.057-.047-.094-.104-.094zm1.79-1.065c-.067 0-.117.053-.127.117l-.214 2.374.214 2.278c.01.064.06.117.127.117.064 0 .117-.053.127-.117l.241-2.278-.241-2.374c-.01-.064-.063-.117-.127-.117zm.899-.238c-.078 0-.136.06-.147.135l-.201 2.612.201 2.31c.011.075.069.135.147.135.077 0 .135-.06.146-.135l.225-2.31-.225-2.612c-.011-.075-.069-.135-.146-.135zm.9-.261c-.088 0-.155.068-.164.155l-.188 2.873.188 2.332c.009.088.076.155.164.155.087 0 .155-.068.164-.155l.209-2.332-.209-2.873c-.009-.087-.077-.155-.164-.155zm2.963-.451c-.098 0-.176.08-.186.177l-.159 3.324.159 2.351c.01.098.088.177.186.177.097 0 .176-.08.186-.177l.176-2.351-.176-3.324c-.01-.098-.089-.177-.186-.177zm-1.062.088c-.098 0-.163.074-.173.163l-.173 3.237.173 2.345c.01.088.075.163.173.163.095 0 .163-.074.173-.163l.194-2.345-.194-3.237c-.01-.088-.078-.163-.173-.163zm2.077-.236c-.107 0-.192.085-.2.196l-.149 3.473.149 2.356c.008.107.093.196.2.196.108 0 .19-.089.2-.196l.169-2.356-.169-3.473c-.01-.111-.092-.196-.2-.196zm1.063-.234c-.118 0-.212.095-.22.214l-.134 3.707.134 2.36c.008.118.102.214.22.214.116 0 .212-.095.22-.214l.15-2.36-.15-3.707c-.008-.12-.104-.214-.22-.214zm1.065-.164c-.127 0-.232.1-.24.232l-.12 3.871.12 2.363c.008.13.113.232.24.232.125 0 .232-.1.24-.232l.135-2.363-.135-3.871c-.008-.132-.115-.232-.24-.232zm1.065.017c-.138 0-.248.11-.256.25l-.105 3.854.105 2.361c.008.14.118.25.256.25.137 0 .247-.11.256-.25l.118-2.361-.118-3.854c-.009-.14-.119-.25-.256-.25zm1.063.235c-.147 0-.266.118-.274.268l-.091 3.619.091 2.359c.008.148.127.268.274.268.146 0 .265-.12.274-.268l.103-2.359-.103-3.619c-.009-.15-.128-.268-.274-.268zm1.064.291c-.158 0-.286.128-.294.287l-.076 3.328.076 2.357c.008.158.136.287.294.287.156 0 .285-.128.294-.287l.086-2.357-.086-3.328c-.009-.16-.138-.287-.294-.287zm3.168.449c-.017-.003-.303-.152-.87-.152-.146 0-.293.01-.438.03-.157 0-.283.128-.291.286l-.072 2.879v.009l.072 2.353c.008.158.134.287.291.287h.001c.014 0 .028-.001.041-.004a2.942 2.942 0 003.12-2.932 2.942 2.942 0 00-1.854-2.756zm-2.128-.277c-.166 0-.299.134-.307.303l-.062 3.277.062 2.35c.008.169.141.303.307.303.165 0 .298-.134.306-.303l.07-2.35-.07-3.277c-.008-.17-.141-.303-.306-.303z"/></svg>' },
];

function detectSocialPlatform(url) {
  if (!url) return null;
  for (const p of SOCIAL_PLATFORMS) {
    if (p.pattern.test(url)) return p;
  }
  return { name: 'Website', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>' };
}

function addSocialLinkRow(url = '') {
  const container = document.getElementById('socialLinksContainer');
  const row = document.createElement('div');
  row.className = 'social-link-row';
  const platform = detectSocialPlatform(url);
  row.innerHTML = `
    <span class="social-link__icon">${platform ? platform.icon : '🔗'}</span>
    <input type="url" class="form-input social-link__url" value="${escapeHtml(url)}" placeholder="https://facebook.com/username" />
    <button type="button" class="btn--remove-social" title="Remove">&times;</button>
  `;
  // Update icon on URL change
  const input = row.querySelector('.social-link__url');
  const iconSpan = row.querySelector('.social-link__icon');
  input.addEventListener('input', () => {
    const p = detectSocialPlatform(input.value);
    iconSpan.innerHTML = p ? p.icon : '🔗';
  });
  row.querySelector('.btn--remove-social').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function getSocialLinksJSON() {
  const rows = document.querySelectorAll('#socialLinksContainer .social-link__url');
  const links = [];
  rows.forEach(input => {
    const url = input.value.trim();
    if (url) links.push(url);
  });
  return links.length ? JSON.stringify(links) : null;
}

function loadSocialLinks(socialLinksStr) {
  const container = document.getElementById('socialLinksContainer');
  container.innerHTML = '';
  if (!socialLinksStr) return;
  try {
    const links = JSON.parse(socialLinksStr);
    if (Array.isArray(links)) {
      links.forEach(url => addSocialLinkRow(url));
    }
  } catch { /* ignore bad JSON */ }
}

// ─── Image Upload / Crop ────────────────────────
let cropState = {
  image: null,
  canvas: null,
  ctx: null,
  isDragging: false,
  startX: 0, startY: 0,
  cropX: 0, cropY: 0, cropW: 0, cropH: 0,
  imgW: 0, imgH: 0,
  scale: 1,
};

function initImageUpload() {
  const dropzone = document.getElementById('imageDropzone');
  const fileInput = document.getElementById('personFormImageFile');
  const btnUrl = document.getElementById('btnImageUrl');
  const urlInput = document.getElementById('personFormImageUrl');
  const btnRemove = document.getElementById('btnRemoveImage');
  const btnCropReset = document.getElementById('btnCropReset');
  const btnCropApply = document.getElementById('btnCropApply');

  // Drag & drop
  ['dragenter', 'dragover'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); });
  });
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImageFile(file);
  });

  // File select
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) loadImageFile(fileInput.files[0]);
  });

  // URL toggle/load
  btnUrl.addEventListener('click', () => {
    urlInput.style.display = urlInput.style.display === 'none' ? 'block' : 'none';
    if (urlInput.style.display === 'block') urlInput.focus();
  });
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const url = urlInput.value.trim();
      if (url) loadImageFromUrl(url);
    }
  });
  urlInput.addEventListener('blur', () => {
    const url = urlInput.value.trim();
    if (url) loadImageFromUrl(url);
  });

  // Remove image
  btnRemove.addEventListener('click', clearImageUpload);

  // Crop controls
  btnCropReset.addEventListener('click', resetCrop);
  btnCropApply.addEventListener('click', applyCrop);

  // Canvas mouse events for crop selection
  const canvas = document.getElementById('imageCropCanvas');
  canvas.addEventListener('mousedown', cropMouseDown);
  canvas.addEventListener('mousemove', cropMouseMove);
  canvas.addEventListener('mouseup', cropMouseUp);
  canvas.addEventListener('mouseleave', cropMouseUp);
  // Touch
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); cropMouseDown(e.touches[0]); });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); cropMouseMove(e.touches[0]); });
  canvas.addEventListener('touchend', cropMouseUp);
}

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => showImagePreview(e.target.result);
  reader.readAsDataURL(file);
}

function loadImageFromUrl(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => showImagePreview(url);
  img.onerror = () => {
    // If cross-origin fails, just use the URL directly
    document.getElementById('personFormImage').value = url;
    showImagePreviewFallback(url);
  };
  img.src = url;
}

function showImagePreviewFallback(url) {
  const previewWrap = document.getElementById('imagePreviewWrap');
  const dropzone = document.getElementById('imageDropzone');
  previewWrap.style.display = 'block';
  dropzone.style.display = 'none';
  const canvas = document.getElementById('imageCropCanvas');
  canvas.style.display = 'none';
  previewWrap.querySelector('.image-upload__crop-controls').style.display = 'none';
  // Show a simple img tag instead
  let fallbackImg = previewWrap.querySelector('.image-upload__fallback-img');
  if (!fallbackImg) {
    fallbackImg = document.createElement('img');
    fallbackImg.className = 'image-upload__fallback-img';
    fallbackImg.style.cssText = 'max-width:100%;max-height:300px;border-radius:8px;';
    previewWrap.insertBefore(fallbackImg, previewWrap.firstChild);
  }
  fallbackImg.src = url;
  fallbackImg.style.display = 'block';
}

function showImagePreview(src) {
  const previewWrap = document.getElementById('imagePreviewWrap');
  const dropzone = document.getElementById('imageDropzone');
  const canvas = document.getElementById('imageCropCanvas');
  const ctx = canvas.getContext('2d');

  // Remove fallback img if present
  const fallbackImg = previewWrap.querySelector('.image-upload__fallback-img');
  if (fallbackImg) fallbackImg.style.display = 'none';
  canvas.style.display = 'block';
  previewWrap.querySelector('.image-upload__crop-controls').style.display = 'flex';

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    // Scale to fit canvas (max 500px wide)
    const maxW = 500;
    const scale = img.width > maxW ? maxW / img.width : 1;
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);

    cropState = {
      image: img,
      canvas, ctx,
      isDragging: false,
      startX: 0, startY: 0,
      cropX: 0, cropY: 0, cropW: w, cropH: h,
      imgW: w, imgH: h, scale,
    };

    previewWrap.style.display = 'block';
    dropzone.style.display = 'none';

    // Store as data URL
    document.getElementById('personFormImage').value = canvas.toDataURL('image/jpeg', 0.85);
  };
  img.src = src;
}

function cropMouseDown(e) {
  if (!cropState.canvas) return;
  const rect = cropState.canvas.getBoundingClientRect();
  cropState.isDragging = true;
  cropState.startX = e.clientX - rect.left;
  cropState.startY = e.clientY - rect.top;
}

function cropMouseMove(e) {
  if (!cropState.isDragging || !cropState.canvas) return;
  const rect = cropState.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  cropState.cropX = Math.min(cropState.startX, x);
  cropState.cropY = Math.min(cropState.startY, y);
  cropState.cropW = Math.abs(x - cropState.startX);
  cropState.cropH = Math.abs(y - cropState.startY);

  // Redraw with selection overlay
  const { ctx, image, imgW, imgH, cropX, cropY, cropW, cropH } = cropState;
  ctx.clearRect(0, 0, imgW, imgH);
  ctx.drawImage(image, 0, 0, imgW, imgH);

  // Dim outside selection
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, imgW, imgH);
  ctx.clearRect(cropX, cropY, cropW, cropH);
  ctx.drawImage(image, cropX, cropY, cropW, cropH, cropX, cropY, cropW, cropH);

  // Selection border
  ctx.strokeStyle = '#8b5cf6';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(cropX, cropY, cropW, cropH);
  ctx.setLineDash([]);
}

function cropMouseUp() {
  cropState.isDragging = false;
}

function resetCrop() {
  if (!cropState.image) return;
  const { ctx, image, imgW, imgH } = cropState;
  cropState.cropX = 0;
  cropState.cropY = 0;
  cropState.cropW = imgW;
  cropState.cropH = imgH;
  ctx.clearRect(0, 0, imgW, imgH);
  ctx.drawImage(image, 0, 0, imgW, imgH);
  document.getElementById('personFormImage').value = cropState.canvas.toDataURL('image/jpeg', 0.85);
}

function applyCrop() {
  if (!cropState.image || cropState.cropW < 10 || cropState.cropH < 10) return;

  const { image, scale, cropX, cropY, cropW, cropH, canvas, ctx } = cropState;

  // Source coordinates in original image
  const sx = cropX / scale;
  const sy = cropY / scale;
  const sw = cropW / scale;
  const sh = cropH / scale;

  // Output canvas at cropped size (max 500px)
  const outScale = cropW > 500 ? 500 / cropW : 1;
  const ow = Math.round(cropW * outScale);
  const oh = Math.round(cropH * outScale);

  canvas.width = ow;
  canvas.height = oh;
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, ow, oh);

  // Update state
  const croppedImg = new Image();
  croppedImg.src = canvas.toDataURL('image/jpeg', 0.85);
  croppedImg.onload = () => {
    cropState.image = croppedImg;
    cropState.imgW = ow;
    cropState.imgH = oh;
    cropState.cropX = 0;
    cropState.cropY = 0;
    cropState.cropW = ow;
    cropState.cropH = oh;
    cropState.scale = 1;
  };

  document.getElementById('personFormImage').value = canvas.toDataURL('image/jpeg', 0.85);
}

function clearImageUpload() {
  document.getElementById('imagePreviewWrap').style.display = 'none';
  document.getElementById('imageDropzone').style.display = 'block';
  document.getElementById('personFormImage').value = '';
  document.getElementById('personFormImageFile').value = '';
  document.getElementById('personFormImageUrl').value = '';
  document.getElementById('personFormImageUrl').style.display = 'none';
  const fallbackImg = document.getElementById('imagePreviewWrap').querySelector('.image-upload__fallback-img');
  if (fallbackImg) fallbackImg.style.display = 'none';
  const canvas = document.getElementById('imageCropCanvas');
  canvas.style.display = 'block';
  document.getElementById('imagePreviewWrap').querySelector('.image-upload__crop-controls').style.display = 'flex';
  cropState = { image: null, canvas: null, ctx: null, isDragging: false, startX: 0, startY: 0, cropX: 0, cropY: 0, cropW: 0, cropH: 0, imgW: 0, imgH: 0, scale: 1 };
}

// Person Modal (shared for Artist / Composer)
function openPersonModal() {
  document.getElementById('personModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closePersonModal() {
  document.getElementById('personModal').style.display = 'none';
  document.body.style.overflow = '';
  clearPersonForm();
}
function clearPersonForm() {
  document.getElementById('personForm').reset();
  document.getElementById('personFormId').value = '';
  document.getElementById('personFormMessage').style.display = 'none';
  clearImageUpload();
  loadSocialLinks(null);
}
function showPersonMessage(text, isError = false) {
  const el = document.getElementById('personFormMessage');
  el.textContent = text;
  el.className = 'form-message ' + (isError ? 'form-message--error' : 'form-message--success');
  el.style.display = 'block';
}

function openNewPerson(type) {
  clearPersonForm();
  const label = type === 'artist' ? 'Artist' : 'Composer';
  document.getElementById('personModalTitle').textContent = 'New ' + label;
  document.getElementById('personBtnSubmit').textContent = 'Create ' + label;
  document.getElementById('personFormType').value = type;
  openPersonModal();
  document.getElementById('personFormName').focus();
}

async function editPerson(type, id) {
  clearPersonForm();
  const label = type === 'artist' ? 'Artist' : 'Composer';
  document.getElementById('personModalTitle').textContent = 'Edit ' + label;
  document.getElementById('personBtnSubmit').textContent = 'Update ' + label;
  document.getElementById('personFormType').value = type;
  openPersonModal();

  try {
    const item = await apiGet(`${ADMIN_API}/${type}/${id}`);
    document.getElementById('personFormId').value = item.id;
    document.getElementById('personFormName').value = item.name || '';
    document.getElementById('personFormSlug').value = item.slug || '';
    document.getElementById('personFormBio').value = item.bio || '';
    document.getElementById('personFormImage').value = item.image_url || '';
    // Load image preview
    if (item.image_url) {
      loadImageFromUrl(item.image_url);
    }
    // Load social links
    loadSocialLinks(item.social_links || null);
  } catch (err) {
    showPersonMessage('Failed to load: ' + err.message, true);
  }
}

async function savePerson(e) {
  e.preventDefault();

  const type = document.getElementById('personFormType').value;
  const id = document.getElementById('personFormId').value;
  const name = document.getElementById('personFormName').value.trim();
  const slug = document.getElementById('personFormSlug').value.trim();
  const bio = document.getElementById('personFormBio').value.trim();
  const image_url = document.getElementById('personFormImage').value.trim();
  const label = type === 'artist' ? 'Artist' : 'Composer';

  if (!name) { showPersonMessage('Name is required.', true); return; }

  const btn = document.getElementById('personBtnSubmit');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const social_links = getSocialLinksJSON();
    const body = { name, slug, bio, image_url, social_links };
    const plural = type + 's';

    if (id) {
      await apiPut(`${ADMIN_API}/${type}/${id}`, body);
      showPersonMessage(label + ' updated successfully!');
    } else {
      await apiPost(`${ADMIN_API}/${plural}`, body);
      showPersonMessage(label + ' created successfully!');
    }

    setTimeout(() => {
      closePersonModal();
      if (type === 'artist') loadArtists(); else loadComposers();
    }, 800);
  } catch (err) {
    showPersonMessage(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = id ? 'Update ' + label : 'Create ' + label;
  }
}

function autoPersonSlug() {
  const slugField = document.getElementById('personFormSlug');
  const nameField = document.getElementById('personFormName');
  if (!slugField.dataset.manual) {
    slugField.value = generateSlug(nameField.value);
  }
}

// ═══════════════════════════════════════════════════
// ═══ DELETE (shared) ══════════════════════════════
// ═══════════════════════════════════════════════════

function confirmDelete(id, name, type) {
  deleteTargetId = id;
  deleteTargetType = type;
  document.getElementById('deleteModalTitle').textContent = 'Delete ' + (type.charAt(0).toUpperCase() + type.slice(1));
  document.getElementById('deleteName').textContent = name;
  document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
  deleteTargetId = null;
  document.getElementById('deleteModal').style.display = 'none';
}

async function deleteItem() {
  if (!deleteTargetId) return;

  const btn = document.getElementById('btnDeleteConfirm');
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  try {
    await apiDelete(`${ADMIN_API}/${deleteTargetType}/${deleteTargetId}`);
    closeDeleteModal();
    if (deleteTargetType === 'song') loadSongs(currentPage);
    else if (deleteTargetType === 'artist') loadArtists();
    else if (deleteTargetType === 'report') loadReports();
    else if (deleteTargetType === 'copyright-owner') loadCopyrightOwners();
    else loadComposers();
  } catch (err) {
    alert('Delete failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Delete';
  }
}

// ═══════════════════════════════════════════════════
// ═══ INIT ═════════════════════════════════════════
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Load songs + populate dropdowns
  loadSongs();
  populateDropdowns();

  // Tab switching
  document.querySelectorAll('.admin__tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Song buttons
  document.getElementById('btnNewSong').addEventListener('click', openNewSong);
  document.getElementById('songForm').addEventListener('submit', saveSong);
  document.getElementById('modalClose').addEventListener('click', closeSongModal);
  document.getElementById('modalBackdrop').addEventListener('click', closeSongModal);
  document.getElementById('btnCancel').addEventListener('click', closeSongModal);

  // Image upload & social links
  initImageUpload();
  document.getElementById('btnAddSocial').addEventListener('click', () => addSocialLinkRow());

  // Artist / Composer buttons
  document.getElementById('btnNewArtist').addEventListener('click', () => openNewPerson('artist'));
  document.getElementById('btnNewComposer').addEventListener('click', () => openNewPerson('composer'));
  document.getElementById('personForm').addEventListener('submit', savePerson);
  document.getElementById('personModalClose').addEventListener('click', closePersonModal);
  document.getElementById('personBackdrop').addEventListener('click', closePersonModal);
  document.getElementById('personBtnCancel').addEventListener('click', closePersonModal);

  // Copyright Owner buttons
  document.getElementById('btnNewCopyrightOwner').addEventListener('click', openNewCopyrightOwner);
  document.getElementById('copyrightOwnerForm').addEventListener('submit', saveCopyrightOwner);
  document.getElementById('coModalClose').addEventListener('click', closeCopyrightOwnerModal);
  document.getElementById('coBackdrop').addEventListener('click', closeCopyrightOwnerModal);
  document.getElementById('coBtnCancel').addEventListener('click', closeCopyrightOwnerModal);

  // Delete modal
  document.getElementById('deleteModalClose').addEventListener('click', closeDeleteModal);
  document.getElementById('deleteBackdrop').addEventListener('click', closeDeleteModal);
  document.getElementById('btnDeleteCancel').addEventListener('click', closeDeleteModal);
  document.getElementById('btnDeleteConfirm').addEventListener('click', deleteItem);

  // Search filter
  let searchTimer;
  document.getElementById('adminSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => filterSongs(e.target.value), 200);
  });

  // Reports filter
  document.getElementById('reportFilterStatus').addEventListener('change', () => renderReportsTable());

  // Feedback detail modal
  document.getElementById('feedbackModalClose').addEventListener('click', closeFeedbackModal);
  document.getElementById('feedbackBackdrop').addEventListener('click', closeFeedbackModal);
  document.getElementById('feedbackBtnClose').addEventListener('click', closeFeedbackModal);

  // Auto-slug on title/name typing
  document.getElementById('formTitle').addEventListener('input', autoSongSlug);
  document.getElementById('formSlug').addEventListener('input', function () {
    this.dataset.manual = this.value ? '1' : '';
  });
  document.getElementById('personFormName').addEventListener('input', autoPersonSlug);
  document.getElementById('personFormSlug').addEventListener('input', function () {
    this.dataset.manual = this.value ? '1' : '';
  });
  document.getElementById('coFormName').addEventListener('input', autoCOSlug);
  document.getElementById('coFormSlug').addEventListener('input', function () {
    this.dataset.manual = this.value ? '1' : '';
  });

  // Keyboard: Escape to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSongModal();
      closePersonModal();
      closeCopyrightOwnerModal();
      closeDeleteModal();
      closeFeedbackModal();
    }
  });
});

// Expose to inline onclick handlers
window.editSong = editSong;
window.editPerson = editPerson;
window.editCopyrightOwner = editCopyrightOwner;
window.confirmDelete = confirmDelete;
window.loadSongs = loadSongs;
window.updateReportStatus = updateReportStatus;
window.viewFeedback = viewFeedback;

// ═══════════════════════════════════════════════════
// ═══ COPYRIGHT OWNERS ═════════════════════════════
// ═══════════════════════════════════════════════════

async function loadCopyrightOwners() {
  const tbody = document.getElementById('copyrightOwnersTableBody');
  tbody.innerHTML = '<tr><td colspan="5" class="admin-table__empty">Loading...</td></tr>';
  try {
    const data = await apiGet(`${ADMIN_API}/copyright-owners`);
    allCopyrightOwners = data.copyright_owners || [];
    renderCopyrightOwnersTable(allCopyrightOwners, tbody);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="admin-table__empty" style="color:var(--danger);">Failed: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderCopyrightOwnersTable(items, tbody) {
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="admin-table__empty">No copyright owners found.</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(item => `
    <tr data-id="${item.id}">
      <td><div class="admin-table__title">${escapeHtml(item.name)}</div></td>
      <td><div class="admin-table__slug">/copyright-owner/${escapeHtml(item.slug)}</div></td>
      <td>${escapeHtml(item.organization || '—')}</td>
      <td>${escapeHtml(item.territory || '—')}</td>
      <td>
        <div class="admin-table__actions">
          <button class="btn btn--sm btn--ghost" onclick="editCopyrightOwner(${item.id})" title="Edit">✏️</button>
          <button class="btn btn--sm btn--ghost btn--danger-text" onclick="confirmDelete(${item.id}, '${escapeHtml(item.name).replace(/'/g, "\\'")}', 'copyright-owner')" title="Delete">🗑️</button>
          <a href="../copyright-owner/${escapeHtml(item.slug)}" target="_blank" class="btn btn--sm btn--ghost" title="View">👁️</a>
        </div>
      </td>
    </tr>
  `).join('');
}

// Copyright Owner Modal
function openCopyrightOwnerModal() {
  document.getElementById('copyrightOwnerModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeCopyrightOwnerModal() {
  document.getElementById('copyrightOwnerModal').style.display = 'none';
  document.body.style.overflow = '';
  clearCopyrightOwnerForm();
}
function clearCopyrightOwnerForm() {
  document.getElementById('copyrightOwnerForm').reset();
  document.getElementById('coFormId').value = '';
  document.getElementById('coFormMessage').style.display = 'none';
}
function showCOMessage(text, isError = false) {
  const el = document.getElementById('coFormMessage');
  el.textContent = text;
  el.className = 'form-message ' + (isError ? 'form-message--error' : 'form-message--success');
  el.style.display = 'block';
}

function openNewCopyrightOwner() {
  clearCopyrightOwnerForm();
  document.getElementById('coModalTitle').textContent = 'New Copyright Owner';
  document.getElementById('coBtnSubmit').textContent = 'Create Copyright Owner';
  openCopyrightOwnerModal();
  document.getElementById('coFormName').focus();
}

async function editCopyrightOwner(id) {
  clearCopyrightOwnerForm();
  document.getElementById('coModalTitle').textContent = 'Edit Copyright Owner';
  document.getElementById('coBtnSubmit').textContent = 'Update Copyright Owner';
  openCopyrightOwnerModal();

  try {
    const item = await apiGet(`${ADMIN_API}/copyright-owner/${id}`);
    document.getElementById('coFormId').value = item.id;
    document.getElementById('coFormName').value = item.name || '';
    document.getElementById('coFormSlug').value = item.slug || '';
    document.getElementById('coFormFullLegalName').value = item.full_legal_name || '';
    document.getElementById('coFormOrganization').value = item.organization || '';
    document.getElementById('coFormTerritory').value = item.territory || '';
    document.getElementById('coFormEmail').value = item.email || '';
    document.getElementById('coFormWebsite').value = item.website || '';
    document.getElementById('coFormAddress').value = item.address || '';
    document.getElementById('coFormIPI').value = item.ipi_number || '';
    document.getElementById('coFormISRC').value = item.isrc_prefix || '';
    document.getElementById('coFormPRO').value = item.pro_affiliation || '';
    document.getElementById('coFormNotes').value = item.notes || '';
  } catch (err) {
    showCOMessage('Failed to load: ' + err.message, true);
  }
}

async function saveCopyrightOwner(e) {
  e.preventDefault();

  const id = document.getElementById('coFormId').value;
  const name = document.getElementById('coFormName').value.trim();
  const slug = document.getElementById('coFormSlug').value.trim();
  const full_legal_name = document.getElementById('coFormFullLegalName').value.trim();
  const organization = document.getElementById('coFormOrganization').value.trim();
  const territory = document.getElementById('coFormTerritory').value.trim();
  const email = document.getElementById('coFormEmail').value.trim();
  const website = document.getElementById('coFormWebsite').value.trim();
  const address = document.getElementById('coFormAddress').value.trim();
  const ipi_number = document.getElementById('coFormIPI').value.trim();
  const isrc_prefix = document.getElementById('coFormISRC').value.trim();
  const pro_affiliation = document.getElementById('coFormPRO').value.trim();
  const notes = document.getElementById('coFormNotes').value.trim();

  if (!name) { showCOMessage('Name is required.', true); return; }

  const btn = document.getElementById('coBtnSubmit');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const body = { name, slug, full_legal_name, organization, territory, email, website, address, ipi_number, isrc_prefix, pro_affiliation, notes };

    if (id) {
      await apiPut(`${ADMIN_API}/copyright-owner/${id}`, body);
      showCOMessage('Copyright owner updated successfully!');
    } else {
      await apiPost(`${ADMIN_API}/copyright-owners`, body);
      showCOMessage('Copyright owner created successfully!');
    }

    setTimeout(() => {
      closeCopyrightOwnerModal();
      loadCopyrightOwners();
    }, 800);
  } catch (err) {
    showCOMessage(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = id ? 'Update Copyright Owner' : 'Create Copyright Owner';
  }
}

function autoCOSlug() {
  const slugField = document.getElementById('coFormSlug');
  const nameField = document.getElementById('coFormName');
  if (!slugField.dataset.manual) {
    slugField.value = generateSlug(nameField.value);
  }
}

// ═══════════════════════════════════════════════════
// ═══ REPORTS ══════════════════════════════════════
// ═══════════════════════════════════════════════════

async function loadReports() {
  const tbody = document.getElementById('reportsTableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="admin-table__empty">Loading...</td></tr>';

  try {
    const data = await apiGet(`${ADMIN_API}/reports`);
    allReports = data.reports || [];
    renderReportsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="admin-table__empty" style="color:var(--danger);">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderReportsTable() {
  const tbody = document.getElementById('reportsTableBody');
  const filterEl = document.getElementById('reportFilterStatus');
  const statusFilter = filterEl ? filterEl.value : '';

  let filtered = allReports;
  if (statusFilter) {
    filtered = allReports.filter(r => r.status === statusFilter);
  }

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="admin-table__empty">${statusFilter ? 'No ' + statusFilter + ' reports.' : 'No reports yet.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const statusColors = { pending: '#f59e0b', reviewed: '#3b82f6', resolved: '#10b981', dismissed: '#6b7280' };
    const statusColor = statusColors[r.status] || '#6b7280';
    const bodyPreview = (r.body || '').length > 80 ? r.body.substring(0, 80) + '...' : (r.body || '');

    return `
      <tr data-id="${r.id}">
        <td>
          <div class="admin-table__title">${escapeHtml(r.song_title || r.song_slug || '—')}</div>
          <div class="admin-table__slug">${escapeHtml(r.song_artist || '')}</div>
        </td>
        <td>
          <div>${escapeHtml(r.reporter_name || '—')}</div>
          <div class="admin-table__slug">${escapeHtml(r.reporter_email || '')}</div>
        </td>
        <td><div class="admin-table__desc" title="${escapeHtml(r.body || '')}">${escapeHtml(bodyPreview)}</div></td>
        <td>
          <select class="report-status-select" onchange="updateReportStatus(${r.id}, this.value)" style="background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;border-radius:var(--radius-md);padding:2px 8px;font-size:var(--text-xs);font-weight:600;cursor:pointer;">
            <option value="pending" ${r.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="reviewed" ${r.status === 'reviewed' ? 'selected' : ''}>Reviewed</option>
            <option value="resolved" ${r.status === 'resolved' ? 'selected' : ''}>Resolved</option>
            <option value="dismissed" ${r.status === 'dismissed' ? 'selected' : ''}>Dismissed</option>
          </select>
        </td>
        <td>${formatDate(r.created_at)}</td>
        <td>
          <div class="admin-table__actions">
            <button class="btn btn--sm btn--ghost" onclick="viewFeedback(${r.id})" title="View Detail">📝</button>
            ${r.song_slug ? `<a href="../song/${escapeHtml(r.song_slug)}" target="_blank" class="btn btn--sm btn--ghost" title="View Song">👁️</a>` : ''}
            <button class="btn btn--sm btn--ghost btn--danger-text" onclick="confirmDelete(${r.id}, 'Report #${r.id}', 'report')" title="Delete">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function updateReportStatus(id, status) {
  try {
    await apiPut(`${ADMIN_API}/report/${id}`, { status });
    // Update local state
    const report = allReports.find(r => r.id === id);
    if (report) report.status = status;
    renderReportsTable();
  } catch (err) {
    alert('Failed to update status: ' + err.message);
    loadReports();
  }
}

// ─── Feedback Detail Modal ─────────────────────────
function viewFeedback(id) {
  const r = allReports.find(rep => rep.id === id);
  if (!r) return;

  const statusLabels = { pending: 'Pending', reviewed: 'Reviewed', resolved: 'Resolved', dismissed: 'Dismissed' };
  const statusColors = { pending: '#f59e0b', reviewed: '#3b82f6', resolved: '#10b981', dismissed: '#6b7280' };
  const color = statusColors[r.status] || '#6b7280';

  document.getElementById('feedbackModalTitle').textContent = `Feedback #${r.id}`;
  document.getElementById('fdSong').textContent = r.song_title || r.song_slug || '—';
  document.getElementById('fdArtist').textContent = r.song_artist || '—';
  document.getElementById('fdReporter').textContent = r.reporter_name || '—';
  document.getElementById('fdEmail').innerHTML = r.reporter_email
    ? `<a href="mailto:${escapeHtml(r.reporter_email)}" style="color:var(--accent);">${escapeHtml(r.reporter_email)}</a>`
    : '—';
  document.getElementById('fdStatus').innerHTML = `<span style="color:${color};font-weight:600;">${statusLabels[r.status] || r.status}</span>`;
  document.getElementById('fdDate').textContent = formatDate(r.created_at);
  document.getElementById('fdBody').textContent = r.body || '—';

  const viewSongBtn = document.getElementById('feedbackBtnViewSong');
  if (r.song_slug) {
    viewSongBtn.href = '../song/' + r.song_slug;
    viewSongBtn.style.display = 'inline-flex';
  } else {
    viewSongBtn.style.display = 'none';
  }

  document.getElementById('feedbackModal').style.display = 'flex';
}

function closeFeedbackModal() {
  document.getElementById('feedbackModal').style.display = 'none';
}
