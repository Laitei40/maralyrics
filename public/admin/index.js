// ┌───────────────────────────────────────────────┐
// │        MaraLyrics — Admin Dashboard Logic     │
// └───────────────────────────────────────────────┘

'use strict';

const WORKER_ORIGIN = 'https://maralyrics.teiteipara.workers.dev';
const API_ORIGIN = window.location.hostname.endsWith('pages.dev') ? WORKER_ORIGIN : '';
const ADMIN_API = `${API_ORIGIN}/api/admin`;

// State
let currentPage = 1;
let totalPages = 1;
let allSongs = [];
let allArtists = [];
let allComposers = [];
let deleteTargetId = null;
let deleteTargetType = 'song'; // 'song' | 'artist' | 'composer'

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
}

// ─── Populate Artist/Composer Dropdowns ─────────
async function populateDropdowns() {
  try {
    const [aData, cData] = await Promise.all([
      apiGet(`${ADMIN_API}/artists`),
      apiGet(`${ADMIN_API}/composers`),
    ]);
    allArtists = aData.artists || [];
    allComposers = cData.composers || [];
  } catch (err) {
    console.warn('Failed to load artists/composers for dropdowns:', err);
  }

  const artistSel = document.getElementById('formArtist');
  const composerSel = document.getElementById('formComposer');

  if (artistSel) {
    artistSel.innerHTML = '<option value="">— None —</option>' +
      allArtists.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  }
  if (composerSel) {
    composerSel.innerHTML = '<option value="">— None —</option>' +
      allComposers.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
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
  const category = document.getElementById('formCategory').value.trim();
  const slug = document.getElementById('formSlug').value.trim();
  const lyrics = document.getElementById('formLyrics').value.trim();

  if (!title) { showFormMessage('Title is required.', true); return; }
  if (!lyrics) { showFormMessage('Lyrics are required.', true); return; }

  const btn = document.getElementById('btnSubmit');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const body = { title, artist_id, composer_id, category, slug, lyrics };

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
    const body = { name, slug, bio, image_url };
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

  // Artist / Composer buttons
  document.getElementById('btnNewArtist').addEventListener('click', () => openNewPerson('artist'));
  document.getElementById('btnNewComposer').addEventListener('click', () => openNewPerson('composer'));
  document.getElementById('personForm').addEventListener('submit', savePerson);
  document.getElementById('personModalClose').addEventListener('click', closePersonModal);
  document.getElementById('personBackdrop').addEventListener('click', closePersonModal);
  document.getElementById('personBtnCancel').addEventListener('click', closePersonModal);

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

  // Auto-slug on title/name typing
  document.getElementById('formTitle').addEventListener('input', autoSongSlug);
  document.getElementById('formSlug').addEventListener('input', function () {
    this.dataset.manual = this.value ? '1' : '';
  });
  document.getElementById('personFormName').addEventListener('input', autoPersonSlug);
  document.getElementById('personFormSlug').addEventListener('input', function () {
    this.dataset.manual = this.value ? '1' : '';
  });

  // Keyboard: Escape to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSongModal();
      closePersonModal();
      closeDeleteModal();
    }
  });
});

// Expose to inline onclick handlers
window.editSong = editSong;
window.editPerson = editPerson;
window.confirmDelete = confirmDelete;
window.loadSongs = loadSongs;
