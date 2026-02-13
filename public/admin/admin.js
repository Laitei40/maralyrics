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
let deleteTargetId = null;

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

// API Calls
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

// Load Songs Table
async function loadSongs(page = 1) {
  const tbody = document.getElementById('songsTableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="admin-table__empty">Loading...</td></tr>';

  try {
    const data = await apiGet(`${ADMIN_API}/songs?page=${page}&limit=50`);
    allSongs = data.songs || [];
    currentPage = data.page;
    totalPages = data.totalPages;

    renderTable(allSongs);
    renderPagination();
    updateStats(data);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="admin-table__empty" style="color:var(--danger);">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderTable(songs) {
  const tbody = document.getElementById('songsTableBody');

  if (!songs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="admin-table__empty">No songs found. Click "+ New Song" to add one.</td></tr>';
    return;
  }

  tbody.innerHTML = songs.map((song) => `
    <tr data-id="${song.id}">
      <td>
        <div class="admin-table__title">${escapeHtml(song.title)}</div>
        <div class="admin-table__slug">/song/${escapeHtml(song.slug)}</div>
      </td>
      <td>${escapeHtml(song.artist || '—')}</td>
      <td>${song.category ? `<span class="song-card__category">${escapeHtml(song.category)}</span>` : '—'}</td>
      <td>${formatViews(song.views)}</td>
      <td>${formatDate(song.created_at)}</td>
      <td>
        <div class="admin-table__actions">
          <button class="btn btn--sm btn--ghost" onclick="editSong(${song.id})" title="Edit">✏️</button>
          <button class="btn btn--sm btn--ghost btn--danger-text" onclick="confirmDelete(${song.id}, '${escapeHtml(song.title).replace(/'/g, "\\'")}')" title="Delete">🗑️</button>
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

// Stats
async function updateStats(data) {
  document.getElementById('statTotal').textContent = data.total || allSongs.length;

  try {
    const catData = await apiGet(`${API_ORIGIN}/api/categories`);
    document.getElementById('statCategories').textContent = catData.categories?.length || 0;
  } catch { /* ignore */ }

  const totalViews = allSongs.reduce((sum, s) => sum + (s.views || 0), 0);
  document.getElementById('statViews').textContent = formatViews(totalViews);
}

// Filter / Search
function filterSongs(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    renderTable(allSongs);
    return;
  }
  const filtered = allSongs.filter(
    (s) =>
      s.title?.toLowerCase().includes(q) ||
      s.artist?.toLowerCase().includes(q) ||
      s.category?.toLowerCase().includes(q)
  );
  renderTable(filtered);
}

// Modal Helpers
function openModal() {
  document.getElementById('songModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('songModal').style.display = 'none';
  document.body.style.overflow = '';
  clearForm();
}

function clearForm() {
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

// New Song
function openNewSong() {
  clearForm();
  document.getElementById('modalTitle').textContent = 'New Song';
  document.getElementById('btnSubmit').textContent = 'Create Song';
  openModal();
  document.getElementById('formTitle').focus();
}

// Edit Song
async function editSong(id) {
  clearForm();
  document.getElementById('modalTitle').textContent = 'Edit Song';
  document.getElementById('btnSubmit').textContent = 'Update Song';
  openModal();

  try {
    const song = await apiGet(`${ADMIN_API}/song/${id}`);
    document.getElementById('formSongId').value = song.id;
    document.getElementById('formTitle').value = song.title || '';
    document.getElementById('formArtist').value = song.artist || '';
    document.getElementById('formCategory').value = song.category || '';
    document.getElementById('formSlug').value = song.slug || '';
    document.getElementById('formLyrics').value = song.lyrics || '';
  } catch (err) {
    showFormMessage('Failed to load song: ' + err.message, true);
  }
}

// Save Song (Create or Update)
async function saveSong(e) {
  e.preventDefault();

  const id = document.getElementById('formSongId').value;
  const title = document.getElementById('formTitle').value.trim();
  const artist = document.getElementById('formArtist').value.trim();
  const category = document.getElementById('formCategory').value.trim();
  const slug = document.getElementById('formSlug').value.trim();
  const lyrics = document.getElementById('formLyrics').value.trim();

  if (!title) { showFormMessage('Title is required.', true); return; }
  if (!lyrics) { showFormMessage('Lyrics are required.', true); return; }

  const btn = document.getElementById('btnSubmit');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const body = { title, artist, category, slug, lyrics };

    if (id) {
      await apiPut(`${ADMIN_API}/song/${id}`, body);
      showFormMessage('Song updated successfully!');
    } else {
      await apiPost(`${ADMIN_API}/songs`, body);
      showFormMessage('Song created successfully!');
    }

    // Reload table after short delay so user sees the success message
    setTimeout(() => {
      closeModal();
      loadSongs(currentPage);
    }, 800);
  } catch (err) {
    showFormMessage(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = id ? 'Update Song' : 'Create Song';
  }
}

// Delete Song
function confirmDelete(id, title) {
  deleteTargetId = id;
  document.getElementById('deleteSongName').textContent = title;
  document.getElementById('deleteModal').style.display = 'flex';
}

function closeDeleteModal() {
  deleteTargetId = null;
  document.getElementById('deleteModal').style.display = 'none';
}

async function deleteSong() {
  if (!deleteTargetId) return;

  const btn = document.getElementById('btnDeleteConfirm');
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  try {
    await apiDelete(`${ADMIN_API}/song/${deleteTargetId}`);
    closeDeleteModal();
    loadSongs(currentPage);
  } catch (err) {
    alert('Delete failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Delete';
  }
}

// Auto-generate slug as user types title
function autoSlug() {
  const slugField = document.getElementById('formSlug');
  const titleField = document.getElementById('formTitle');
  // Only auto-generate if slug field is empty or was auto-generated
  if (!slugField.dataset.manual) {
    slugField.value = generateSlug(titleField.value);
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  // Load songs
  loadSongs();

  // New song button
  document.getElementById('btnNewSong').addEventListener('click', openNewSong);

  // Form submit
  document.getElementById('songForm').addEventListener('submit', saveSong);

  // Modal close buttons
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalBackdrop').addEventListener('click', closeModal);
  document.getElementById('btnCancel').addEventListener('click', closeModal);

  // Delete modal
  document.getElementById('deleteModalClose').addEventListener('click', closeDeleteModal);
  document.getElementById('deleteBackdrop').addEventListener('click', closeDeleteModal);
  document.getElementById('btnDeleteCancel').addEventListener('click', closeDeleteModal);
  document.getElementById('btnDeleteConfirm').addEventListener('click', deleteSong);

  // Search filter
  let searchTimer;
  document.getElementById('adminSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => filterSongs(e.target.value), 200);
  });

  // Auto-slug on title typing
  document.getElementById('formTitle').addEventListener('input', autoSlug);

  // Mark slug as manual if user explicitly edits it
  document.getElementById('formSlug').addEventListener('input', function () {
    this.dataset.manual = this.value ? '1' : '';
  });

  // Keyboard: Escape to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeDeleteModal();
    }
  });
});

// Expose to inline onclick handlers
window.editSong = editSong;
window.confirmDelete = confirmDelete;
window.loadSongs = loadSongs;
