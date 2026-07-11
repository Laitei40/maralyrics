// ┌───────────────────────────────────────────────┐
// │        MaraLyrics — Admin Dashboard Logic     │
// └───────────────────────────────────────────────┘

'use strict';

const WORKER_ORIGIN = 'https://api.maralyrics.com';
const SITE_ORIGIN = 'https://maralyrics.com';
const IS_PAGES = window.location.hostname.endsWith('pages.dev') || window.location.hostname.endsWith('maralyrics.com');
const API_ORIGIN = IS_PAGES ? WORKER_ORIGIN : '';
const API_BASE = `${API_ORIGIN}/api/v1`;
const ADMIN_API = `${API_BASE}/admin`;

// ─── Admin session (JWT, per-account role) ──────────
const TOKEN_KEY = 'ml_admin_jwt';
const INFO_KEY = 'ml_admin_info'; // { id, username, role }

function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
function setAdminToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
function getAdminInfo() {
  try { return JSON.parse(localStorage.getItem(INFO_KEY) || 'null'); } catch { return null; }
}
function setAdminInfo(info) {
  localStorage.setItem(INFO_KEY, JSON.stringify(info));
}
function clearAdminSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(INFO_KEY);
}
function authHeaders(extra = {}) {
  return { ...extra, Authorization: `Bearer ${getAdminToken()}` };
}
function hasRole(...roles) {
  const info = getAdminInfo();
  return !!info && roles.includes(info.role);
}

function showLoginOverlay(message) {
  document.getElementById('loginOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  const errEl = document.getElementById('loginError');
  errEl.textContent = message || '';
  errEl.style.display = message ? 'block' : 'none';
}
function hideLoginOverlay() {
  document.getElementById('loginOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginSubmit');
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const res = await fetch(`${ADMIN_API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Login failed');

    setAdminToken(data.token);
    setAdminInfo({ id: data.id, username: data.username, role: data.role });
    hideLoginOverlay();
    document.getElementById('loginForm').reset();
    initDashboard();
  } catch (err) {
    const errEl = document.getElementById('loginError');
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
}

function logout() {
  clearAdminSession();
  location.reload();
}

async function changePassword() {
  const current_password = window.prompt('Current password:');
  if (!current_password) return;
  const new_password = window.prompt('New password (min 8 characters):');
  if (!new_password) return;

  try {
    await apiPost(`${ADMIN_API}/auth/change-password`, { current_password, new_password });
    if (typeof Toast !== 'undefined') Toast.show('Password updated.', { type: 'success' });
    else alert('Password updated.');
  } catch (err) {
    alert('Failed to change password: ' + err.message);
  }
}

// ─── Role-based UI visibility ───────────────────────
// Keep in sync with worker/lib/permissions.js — index.js is a plain <script>,
// not a module, so it can't import that file directly; the lists are duplicated here.
const ROLES_ALL = ['viewer', 'translator', 'reviewer', 'editor', 'manager', 'super_admin'];

const CAN_CREATE_SONG        = ['translator', 'editor', 'manager', 'super_admin'];
const CAN_EDIT_SONG_DIRECT   = ['editor', 'manager', 'super_admin'];
const CAN_SUBMIT_REVISION    = ['translator', 'editor', 'manager', 'super_admin'];
const CAN_REVIEW_REVISIONS   = ['reviewer', 'manager', 'super_admin'];
const CAN_PUBLISH_UNPUBLISH  = ['reviewer', 'editor', 'manager', 'super_admin'];
const CAN_ARCHIVE_RESTORE    = ['reviewer', 'manager', 'super_admin'];
const CAN_DELETE_SONG        = ['manager', 'super_admin'];
const CAN_MANAGE_REFERENCE_DATA = ['manager', 'super_admin'];
const CAN_MANAGE_ADMIN_USERS = ['manager', 'super_admin'];

function statusChangePermission(fromStatus, toStatus) {
  return fromStatus === 'archived' || toStatus === 'archived' ? CAN_ARCHIVE_RESTORE : CAN_PUBLISH_UNPUBLISH;
}

// Keep in sync with worker/lib/avatars.js — the built-in, no-upload avatar set.
const AVATARS = [
  '🦊', '🐱', '🐶', '🐼', '🐨', '🐵', '🦁', '🐯',
  '🐸', '🐧', '🦉', '🦄', '🐝', '🦋', '🐢', '🐙',
  '🦖', '🐳', '🌵', '🌸', '⭐', '🔥', '🎧', '🎸',
];

function avatarHtml(avatar, username) {
  return avatar || (username ? username.charAt(0).toUpperCase() : '👤');
}

const ROLE_TABS = {
  songs: ROLES_ALL,
  artists: ROLES_ALL,
  composers: ROLES_ALL,
  'copyright-owners': ROLES_ALL,
  reports: ['translator', 'reviewer', 'editor', 'manager', 'super_admin'],
  revisions: ['reviewer', 'manager', 'super_admin'],
  auditlog: ['reviewer', 'manager', 'super_admin'],
  contacts: ['super_admin'],
  admins: ['manager', 'super_admin'],
};

function applyRoleVisibility() {
  const info = getAdminInfo();
  const label = document.getElementById('currentAdminLabel');
  if (label) label.textContent = info ? `${info.username} (${roleLabel(info.role)})` : 'Admin';

  let firstVisibleTab = null;
  document.querySelectorAll('.admin__tab').forEach((tab) => {
    const allowed = ROLE_TABS[tab.dataset.tab] || [];
    const visible = !!info && allowed.includes(info.role);
    tab.style.display = visible ? '' : 'none';
    if (visible && !firstVisibleTab) firstVisibleTab = tab.dataset.tab;
  });

  const activeTab = document.querySelector('.admin__tab.active');
  if (firstVisibleTab && (!activeTab || activeTab.style.display === 'none')) {
    switchTab(firstVisibleTab);
  }

  // Per-button gating within a visible tab — a role can see a tab but not every action in it.
  toggleEl('btnNewSong', hasRole(...CAN_CREATE_SONG));
  toggleEl('btnNewArtist', hasRole(...CAN_MANAGE_REFERENCE_DATA));
  toggleEl('btnNewComposer', hasRole(...CAN_MANAGE_REFERENCE_DATA));
  toggleEl('btnNewCopyrightOwner', hasRole(...CAN_MANAGE_REFERENCE_DATA));
  toggleEl('btnNewAdminUser', hasRole(...CAN_MANAGE_ADMIN_USERS));

  const superAdminOption = document.querySelector('#auFormRole option[value="super_admin"]');
  if (superAdminOption) superAdminOption.style.display = hasRole('super_admin') ? '' : 'none';
}

function toggleEl(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

function roleLabel(role) {
  return {
    viewer: 'Viewer',
    translator: 'Translator',
    reviewer: 'Reviewer',
    editor: 'Editor',
    manager: 'Manager',
    super_admin: 'Admin (Super Admin)',
  }[role] || role;
}

// State
let currentPage = 1;
let totalPages = 1;
let allSongs = [];
let allArtists = [];
let allComposers = [];
let deleteTargetId = null;
let deleteTargetType = 'song'; // 'song' | 'artist' | 'composer' | 'report' | 'admin-user' | 'contact'
let allReports = [];
let allCopyrightOwners = [];
let allAdminUsers = [];
let allRevisions = [];
let allAuditLog = [];
let allContacts = [];
let currentRevisionId = null;
let currentProfileId = null;
let currentProfileIsFollowing = false;
let selectedAvatar = null;
let allAdminDirectory = [];

// ═══════════════════════════════════════════════════
// ═══ DRAFT MANAGEMENT (localStorage auto-save) ════
// ═══════════════════════════════════════════════════

const DRAFT_PREFIX = 'ml_admin_draft_';

function draftKey(type, id) {
  return DRAFT_PREFIX + type + '_' + (id || 'new');
}
function saveDraft(type, id, data) {
  try { localStorage.setItem(draftKey(type, id), JSON.stringify({ data, savedAt: Date.now() })); } catch {}
}
function loadDraft(type, id) {
  try {
    const raw = localStorage.getItem(draftKey(type, id));
    if (!raw) return null;
    return JSON.parse(raw).data || null;
  } catch { return null; }
}
function clearDraft(type, id) {
  try { localStorage.removeItem(draftKey(type, id)); } catch {}
}
function showDraftBanner(bannerId) {
  const banner = document.getElementById(bannerId);
  if (banner) banner.style.display = 'flex';
}
function hideDraftBanner(bannerId, indicatorId) {
  const banner = document.getElementById(bannerId);
  if (banner) banner.style.display = 'none';
  if (indicatorId) {
    const ind = document.getElementById(indicatorId);
    if (ind) ind.style.display = 'none';
  }
}
function updateDraftIndicator(indicatorId) {
  const ind = document.getElementById(indicatorId);
  if (!ind) return;
  const now = new Date();
  ind.textContent = 'Draft saved at ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  ind.style.display = 'block';
}

// Checkbox-list helpers (Artist/Composer fields allow picking more than one, up to 20).
// A checkbox list is used instead of a native <select multiple> because a plain click on
// an option in <select multiple> — without holding Ctrl/Cmd — silently deselects every
// other option, which previously caused real data loss (a song's existing artist/composer
// credits got wiped just by clicking to add one more without the modifier key held).
const MAX_CREDITED_PEOPLE_CLIENT = 20;

// "Unknown" is a UI-only sentinel — a song can genuinely have no known artist/composer
// (traditional/folk songs). It isn't a real artist/composer row: checking it just means
// "confirmed unknown", mutually exclusive with picking real people, and saves as an empty
// artist_ids/composer_ids array exactly like leaving the list untouched would.
const UNKNOWN_CHECKBOX_SELECTOR = 'input[data-unknown="1"]';

function getSelectedIds(containerEl) {
  if (!containerEl) return [];
  return Array.from(containerEl.querySelectorAll(`input[type="checkbox"]:checked:not(${UNKNOWN_CHECKBOX_SELECTOR})`))
    .map(cb => Number(cb.value));
}
function setSelectedIds(containerEl, ids) {
  if (!containerEl) return;
  const set = new Set((ids || []).map(Number));
  containerEl.querySelectorAll(`input[type="checkbox"]:not(${UNKNOWN_CHECKBOX_SELECTOR})`).forEach(cb => {
    cb.checked = set.has(Number(cb.value));
  });
  const unknownCb = containerEl.querySelector(UNKNOWN_CHECKBOX_SELECTOR);
  if (unknownCb) unknownCb.checked = false;
  updateCheckboxListState(containerEl);
}

function updateCheckboxListState(containerEl) {
  if (!containerEl) return;
  const unknownCb = containerEl.querySelector(UNKNOWN_CHECKBOX_SELECTOR);
  const realBoxes = Array.from(containerEl.querySelectorAll(`input[type="checkbox"]:not(${UNKNOWN_CHECKBOX_SELECTOR})`));
  const selectedCount = realBoxes.filter(cb => cb.checked).length;

  // Mutually exclusive: picking "Unknown" disables real options, and vice versa.
  if (unknownCb) {
    realBoxes.forEach(cb => { cb.disabled = unknownCb.checked; });
    unknownCb.disabled = selectedCount > 0;
  }

  const countEl = containerEl.parentElement?.querySelector('.checkbox-list__count');
  if (countEl) {
    countEl.textContent = `${selectedCount} / ${MAX_CREDITED_PEOPLE_CLIENT} selected`;
    countEl.classList.toggle('checkbox-list__count--full', selectedCount >= MAX_CREDITED_PEOPLE_CLIENT);
  }
}

function buildCheckboxList(containerEl, items) {
  if (!containerEl) return;
  const unknownRow = `
    <label class="checkbox-list__item checkbox-list__item--unknown">
      <input type="checkbox" data-unknown="1" />
      <span>Unknown</span>
    </label>
    <div class="checkbox-list__divider"></div>
  `;
  const itemRows = items.map(item => `
    <label class="checkbox-list__item" data-name="${escapeHtml(item.name.toLowerCase())}">
      <input type="checkbox" value="${item.id}" />
      <span>${escapeHtml(item.name)}</span>
    </label>
  `).join('') || '<div class="checkbox-list__empty">None yet.</div>';

  containerEl.innerHTML = unknownRow + itemRows;

  containerEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (getSelectedIds(containerEl).length > MAX_CREDITED_PEOPLE_CLIENT) {
        cb.checked = false;
        if (typeof Toast !== 'undefined') Toast.show(`You can select up to ${MAX_CREDITED_PEOPLE_CLIENT}.`, { type: 'error' });
        else alert(`You can select up to ${MAX_CREDITED_PEOPLE_CLIENT}.`);
      }
      updateCheckboxListState(containerEl);
    });
  });
  updateCheckboxListState(containerEl);
}
function wireCheckboxListFilter(filterEl, containerEl) {
  if (!filterEl || !containerEl) return;
  filterEl.addEventListener('input', () => {
    const q = filterEl.value.trim().toLowerCase();
    // "Unknown" is pinned at the top and always stays visible regardless of the filter —
    // it has no `data-name` since it isn't a real, filterable artist/composer.
    containerEl.querySelectorAll('.checkbox-list__item:not(.checkbox-list__item--unknown)').forEach((row) => {
      row.classList.toggle('checkbox-list__item--hidden', !!q && !row.dataset.name.includes(q));
    });
  });
}

// ─── Song Draft ─────────────────────────────────
let _songDraftTimer = null;
function autoSaveSongDraft() {
  clearTimeout(_songDraftTimer);
  _songDraftTimer = setTimeout(() => {
    const id = document.getElementById('formSongId')?.value || null;
    const data = {
      title: document.getElementById('formTitle')?.value || '',
      artist_ids: getSelectedIds(document.getElementById('formArtist')),
      composer_ids: getSelectedIds(document.getElementById('formComposer')),
      category: document.getElementById('formCategory')?.value || '',
      copyright_owner_id: document.getElementById('formCopyrightOwner')?.value || '',
      slug: document.getElementById('formSlug')?.value || '',
      lyrics: document.getElementById('formLyrics')?.value || '',
    };
    if (data.title || data.lyrics) {
      saveDraft('song', id, data);
      updateDraftIndicator('songDraftIndicator');
    }
  }, 1500);
}
function restoreSongDraftData(draft) {
  if (!draft) return;
  if (draft.title !== undefined) document.getElementById('formTitle').value = draft.title;
  if (draft.artist_ids?.length) setSelectedIds(document.getElementById('formArtist'), draft.artist_ids);
  if (draft.composer_ids?.length) setSelectedIds(document.getElementById('formComposer'), draft.composer_ids);
  if (draft.category) document.getElementById('formCategory').value = draft.category;
  if (draft.copyright_owner_id) document.getElementById('formCopyrightOwner').value = draft.copyright_owner_id;
  if (draft.slug !== undefined) {
    document.getElementById('formSlug').value = draft.slug;
    if (draft.slug) document.getElementById('formSlug').dataset.manual = '1';
  }
  if (draft.lyrics !== undefined) document.getElementById('formLyrics').value = draft.lyrics;
}

// ─── Person Draft ────────────────────────────────
let _personDraftTimer = null;
function autoSavePersonDraft() {
  clearTimeout(_personDraftTimer);
  _personDraftTimer = setTimeout(() => {
    const type = document.getElementById('personFormType')?.value || 'artist';
    const id = document.getElementById('personFormId')?.value || null;
    const data = {
      name: document.getElementById('personFormName')?.value || '',
      slug: document.getElementById('personFormSlug')?.value || '',
      bio: document.getElementById('personFormBio')?.value || '',
    };
    if (data.name || data.bio) {
      saveDraft(type, id, data);
      updateDraftIndicator('personDraftIndicator');
    }
  }, 1500);
}
function restorePersonDraftData(draft) {
  if (!draft) return;
  if (draft.name !== undefined) document.getElementById('personFormName').value = draft.name;
  if (draft.slug !== undefined) {
    document.getElementById('personFormSlug').value = draft.slug;
    if (draft.slug) document.getElementById('personFormSlug').dataset.manual = '1';
  }
  if (draft.bio !== undefined) document.getElementById('personFormBio').value = draft.bio;
}

// ─── Copyright Owner Draft ───────────────────────
let _coDraftTimer = null;
function autoSaveCoDraft() {
  clearTimeout(_coDraftTimer);
  _coDraftTimer = setTimeout(() => {
    const id = document.getElementById('coFormId')?.value || null;
    const data = {
      name: document.getElementById('coFormName')?.value || '',
      slug: document.getElementById('coFormSlug')?.value || '',
      full_legal_name: document.getElementById('coFormFullLegalName')?.value || '',
      organization: document.getElementById('coFormOrganization')?.value || '',
      territory: document.getElementById('coFormTerritory')?.value || '',
    };
    if (data.name) {
      saveDraft('copyright-owner', id, data);
      updateDraftIndicator('coDraftIndicator');
    }
  }, 1500);
}
function restoreCoDraftData(draft) {
  if (!draft) return;
  if (draft.name !== undefined) document.getElementById('coFormName').value = draft.name;
  if (draft.slug !== undefined) {
    document.getElementById('coFormSlug').value = draft.slug;
    if (draft.slug) document.getElementById('coFormSlug').dataset.manual = '1';
  }
  if (draft.full_legal_name !== undefined) document.getElementById('coFormFullLegalName').value = draft.full_legal_name;
  if (draft.organization !== undefined) document.getElementById('coFormOrganization').value = draft.organization;
  if (draft.territory !== undefined) document.getElementById('coFormTerritory').value = draft.territory;
}

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
async function handleAuthFailure(res) {
  if (res.status === 401) {
    clearAdminSession();
    showLoginOverlay('Session expired. Please sign in again.');
  }
}

async function apiGet(url) {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    await handleAuthFailure(res);
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status}`);
  }
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    await handleAuthFailure(res);
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

async function apiPut(url, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    await handleAuthFailure(res);
    throw new Error(data.error || `Error ${res.status}`);
  }
  return data;
}

async function apiDelete(url) {
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  const data = await res.json();
  if (!res.ok) {
    await handleAuthFailure(res);
    throw new Error(data.error || `Error ${res.status}`);
  }
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
  if (tab === 'admins') loadAdminUsers();
  if (tab === 'revisions') loadRevisions();
  if (tab === 'auditlog') loadAuditLog();
  if (tab === 'contacts') loadContacts();
}

// ─── Populate Artist/Composer Dropdowns ─────────
// Deduped: called both at startup and every time the song modal opens. Without this,
// two concurrent calls could each rebuild the checkbox lists' innerHTML — if the
// startup call's rebuild lands AFTER a form's selections were just set, it silently
// wipes them back to unchecked.
let dropdownsLoadPromise = null;

async function populateDropdowns() {
  if (dropdownsLoadPromise) return dropdownsLoadPromise;
  dropdownsLoadPromise = (async () => {
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

    buildCheckboxList(document.getElementById('formArtist'), allArtists);
    buildCheckboxList(document.getElementById('formComposer'), allComposers);

    const coSel = document.getElementById('formCopyrightOwner');
    if (coSel) {
      coSel.innerHTML = '<option value="">— None —</option>' +
        allCopyrightOwners.map(co => `<option value="${co.id}">${escapeHtml(co.name)}</option>`).join('');
    }
  })();
  try {
    await dropdownsLoadPromise;
  } finally {
    dropdownsLoadPromise = null;
  }
}

// ═══════════════════════════════════════════════════
// ═══ SONGS ════════════════════════════════════════
// ═══════════════════════════════════════════════════

let currentSearchQuery = '';

async function loadSongs(page = 1, query = currentSearchQuery) {
  const tbody = document.getElementById('songsTableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="admin-table__empty">Loading...</td></tr>';
  currentSearchQuery = query || '';

  try {
    // Search runs server-side across the whole table, not just the currently loaded
    // page — filtering only `allSongs` client-side would silently miss matches on
    // any page other than the one currently displayed.
    const qParam = currentSearchQuery ? `&q=${encodeURIComponent(currentSearchQuery)}` : '';
    const data = await apiGet(`${ADMIN_API}/songs?page=${page}&limit=50${qParam}`);
    allSongs = data.songs || [];
    currentPage = data.page;
    totalPages = data.totalPages;

    renderSongsTable(allSongs);
    renderPagination();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="admin-table__empty" style="color:var(--danger);">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function statusBadgeHtml(status) {
  const labels = { pending: 'Pending', published: 'Published', archived: 'Archived' };
  return `<span class="status-badge status-badge--${status}">${labels[status] || status}</span>`;
}

// Inline Publish/Set-Pending/Archive/Restore icons for the songs table row — same
// permission split as the backend's PUT /songs/:id/status (Editor gets publish/unpublish
// but never archive/restore).
function songStatusActionsHtml(song) {
  const info = getAdminInfo();
  if (!info) return '';
  const allowed = (target) => statusChangePermission(song.status, target).includes(info.role);
  const buttons = [];

  if (song.status !== 'published' && allowed('published')) {
    buttons.push(`<button class="btn btn--sm btn--ghost" onclick="changeSongStatus(${song.id}, 'published')" title="Publish">📢</button>`);
  }
  if (song.status === 'published' && allowed('pending')) {
    buttons.push(`<button class="btn btn--sm btn--ghost" onclick="changeSongStatus(${song.id}, 'pending')" title="Set Pending">⏸️</button>`);
  }
  if (song.status !== 'archived' && allowed('archived')) {
    buttons.push(`<button class="btn btn--sm btn--ghost" onclick="changeSongStatus(${song.id}, 'archived')" title="Archive">🗄️</button>`);
  }
  if (song.status === 'archived' && allowed('pending')) {
    buttons.push(`<button class="btn btn--sm btn--ghost" onclick="changeSongStatus(${song.id}, 'pending')" title="Restore">♻️</button>`);
  }
  return buttons.join('');
}

async function changeSongStatus(id, status) {
  try {
    const updated = await apiPut(`${ADMIN_API}/songs/${id}/status`, { status });
    const song = allSongs.find(s => s.id === id);
    if (song) song.status = updated.status;
    renderSongsTable(allSongs);
    if (document.getElementById('formSongId')?.value == id) {
      renderSongStatusRow(updated);
    }
  } catch (err) {
    if (typeof Toast !== 'undefined') Toast.show('Failed to update status: ' + err.message, { type: 'error' });
    else alert('Failed to update status: ' + err.message);
  }
}

function renderSongsTable(songs) {
  const tbody = document.getElementById('songsTableBody');

  if (!songs.length) {
    tbody.innerHTML = currentSearchQuery
      ? '<tr><td colspan="8" class="admin-table__empty">No songs match your search.</td></tr>'
      : '<tr><td colspan="8" class="admin-table__empty">No songs found. Click "+ New Song" to add one.</td></tr>';
    return;
  }

  const canDelete = hasRole(...CAN_DELETE_SONG);

  tbody.innerHTML = songs.map((song) => `
    <tr data-id="${song.id}">
      <td>
        <div class="admin-table__title">${escapeHtml(song.title)}</div>
        <div class="admin-table__slug">/song/${escapeHtml(song.slug)}</div>
      </td>
      <td>${escapeHtml(song.artist_name || song.artist || '—')}</td>
      <td>${escapeHtml(song.composer_name || song.composer || '—')}</td>
      <td>${song.category ? `<span class="song-card__category">${escapeHtml(song.category)}</span>` : '—'}</td>
      <td>${statusBadgeHtml(song.status || 'published')}</td>
      <td>${formatViews(song.views)}</td>
      <td>${formatDate(song.created_at)}</td>
      <td>
        <div class="admin-table__actions">
          <button class="btn btn--sm btn--ghost" onclick="editSong(${song.id})" title="Edit">✏️</button>
          ${songStatusActionsHtml(song)}
          ${canDelete ? `<button class="btn btn--sm btn--ghost btn--danger-text" onclick="confirmDelete(${song.id}, '${escapeHtml(song.title).replace(/'/g, "\\'")}', 'song')" title="Delete">🗑️</button>` : ''}
          <a href="${SITE_ORIGIN}/song/${escapeHtml(song.slug)}" target="_blank" class="btn btn--sm btn--ghost" title="View">👁️</a>
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

// Site-wide totals (NOT affected by pagination or search) — sourced from the public
// /stats endpoint, which aggregates across the whole table, unlike the paginated song list.
async function refreshStats() {
  try {
    const stats = await apiGet(`${API_BASE}/stats`);
    document.getElementById('statTotal').textContent = stats.songs ?? 0;
    document.getElementById('statCategories').textContent = stats.categories ?? 0;
    document.getElementById('statViews').textContent = formatViews(stats.total_views ?? 0);
  } catch { /* ignore — stat cards just keep showing the previous values */ }
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
  hideDraftBanner('songDraftBanner', 'songDraftIndicator');
}
function showFormMessage(text, isError = false) {
  const el = document.getElementById('formMessage');
  el.textContent = text;
  el.className = 'form-message ' + (isError ? 'form-message--error' : 'form-message--success');
  el.style.display = 'block';
}

// Disables/enables the song content fields (everything except the status row) — used by
// applySongModalPermissions so a role that can only view or only change status never gets
// a form it can silently edit and lose.
function setSongFieldsDisabled(disabled) {
  ['formTitle', 'formCopyrightOwner', 'formCategory', 'formSlug', 'formLyrics'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  });
  ['formArtist', 'formComposer'].forEach((id) => {
    const container = document.getElementById(id);
    if (!container) return;
    container.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.disabled = disabled; });
    if (!disabled) updateCheckboxListState(container); // reconcile Unknown/real mutual exclusivity
  });
}

// Populates the status badge + Publish/Set-Pending/Archive/Restore buttons, each shown only
// if the current role has that specific permission for the song's current status — mirrors
// the backend's statusChangePermission() split (Editor: publish/unpublish, not archive/restore).
function renderSongStatusRow(song) {
  const row = document.getElementById('songStatusRow');
  const badge = document.getElementById('songStatusBadge');
  const actions = document.getElementById('songStatusActions');
  if (!row || !badge || !actions) return;
  if (!song || !song.status) { row.style.display = 'none'; return; }

  row.style.display = 'flex';
  badge.className = 'status-badge status-badge--' + song.status;
  badge.textContent = { pending: 'Pending', published: 'Published', archived: 'Archived' }[song.status] || song.status;

  const info = getAdminInfo();
  const allowed = (target) => !!info && statusChangePermission(song.status, target).includes(info.role);
  const buttons = [];
  if (song.status !== 'published' && allowed('published')) {
    buttons.push(`<button type="button" class="btn btn--sm btn--ghost" onclick="changeSongStatus(${song.id}, 'published')">Publish</button>`);
  }
  if (song.status === 'published' && allowed('pending')) {
    buttons.push(`<button type="button" class="btn btn--sm btn--ghost" onclick="changeSongStatus(${song.id}, 'pending')">Set Pending</button>`);
  }
  if (song.status !== 'archived' && allowed('archived')) {
    buttons.push(`<button type="button" class="btn btn--sm btn--ghost" onclick="changeSongStatus(${song.id}, 'archived')">Archive</button>`);
  }
  if (song.status === 'archived' && allowed('pending')) {
    buttons.push(`<button type="button" class="btn btn--sm btn--ghost" onclick="changeSongStatus(${song.id}, 'pending')">Restore</button>`);
  }
  actions.innerHTML = buttons.join('');
}

// Drives every role-conditional part of the song modal (field editability, status row,
// which of Update Song / Submit for Revision are offered) from two facts: are we creating
// or editing, and what can this role do. See migrations/0004 + worker/lib/permissions.js.
function applySongModalPermissions(mode, role, song) {
  const btnSubmit = document.getElementById('btnSubmit');
  const btnSubmitRevision = document.getElementById('btnSubmitRevision');
  const statusRow = document.getElementById('songStatusRow');

  if (mode === 'create') {
    setSongFieldsDisabled(false);
    statusRow.style.display = 'none';
    btnSubmit.style.display = '';
    btnSubmit.textContent = 'Create Song';
    btnSubmitRevision.style.display = 'none';
    return;
  }

  renderSongStatusRow(song);

  const canEditDirect = CAN_EDIT_SONG_DIRECT.includes(role);
  const canSubmitRevision = CAN_SUBMIT_REVISION.includes(role);

  setSongFieldsDisabled(!canEditDirect && !canSubmitRevision);

  btnSubmit.style.display = canEditDirect ? '' : 'none';
  btnSubmit.textContent = 'Update Song';

  btnSubmitRevision.style.display = canSubmitRevision ? '' : 'none';
  btnSubmitRevision.textContent = 'Submit for Revision';
}

function openNewSong() {
  if (!hasRole(...CAN_CREATE_SONG)) return;
  clearSongForm();
  document.getElementById('modalTitle').textContent = 'New Song';
  populateDropdowns();
  openSongModal();
  applySongModalPermissions('create', getAdminInfo()?.role, null);
  document.getElementById('formTitle').focus();
  // Check for unsaved draft
  const draft = loadDraft('song', null);
  if (draft && (draft.title || draft.lyrics)) {
    showDraftBanner('songDraftBanner');
  }
}

async function editSong(id) {
  clearSongForm();
  document.getElementById('modalTitle').textContent = 'Edit Song';
  await populateDropdowns();
  openSongModal();

  try {
    const song = await apiGet(`${ADMIN_API}/songs/${id}`);
    document.getElementById('formSongId').value = song.id;
    document.getElementById('formTitle').value = song.title || '';
    setSelectedIds(document.getElementById('formArtist'), (song.artists || []).map(a => a.id));
    setSelectedIds(document.getElementById('formComposer'), (song.composers || []).map(c => c.id));
    document.getElementById('formCategory').value = song.category || '';
    document.getElementById('formCopyrightOwner').value = song.copyright_owner_id || '';
    document.getElementById('formSlug').value = song.slug || '';
    document.getElementById('formLyrics').value = song.lyrics || '';
    applySongModalPermissions('edit', getAdminInfo()?.role, song);
    // Check for unsaved draft for this song
    const draft = loadDraft('song', song.id);
    if (draft && (draft.title || draft.lyrics)) {
      showDraftBanner('songDraftBanner');
    }
  } catch (err) {
    showFormMessage('Failed to load song: ' + err.message, true);
  }
}

function gatherSongFormData() {
  return {
    title: document.getElementById('formTitle').value.trim(),
    artist_ids: getSelectedIds(document.getElementById('formArtist')),
    composer_ids: getSelectedIds(document.getElementById('formComposer')),
    copyright_owner_id: document.getElementById('formCopyrightOwner').value || null,
    category: document.getElementById('formCategory').value.trim(),
    slug: document.getElementById('formSlug').value.trim(),
    lyrics: document.getElementById('formLyrics').value.trim(),
  };
}

function validateSongFormData(body) {
  if (!body.title) return 'Title is required.';
  if (!body.lyrics) return 'Lyrics are required.';
  if (body.artist_ids.length > 20) return 'A song can have at most 20 artists.';
  if (body.composer_ids.length > 20) return 'A song can have at most 20 composers.';
  return null;
}

// Direct save — creates a new song, or applies an edit immediately for roles allowed to
// bypass the revision queue (Editor/Manager/Admin). Never touches status.
async function saveSongDirect(e) {
  e.preventDefault();

  const id = document.getElementById('formSongId').value;
  const body = gatherSongFormData();
  const error = validateSongFormData(body);
  if (error) { showFormMessage(error, true); return; }

  const btn = document.getElementById('btnSubmit');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    if (id) {
      await apiPut(`${ADMIN_API}/songs/${id}`, body);
      showFormMessage('Song updated successfully!');
    } else {
      await apiPost(`${ADMIN_API}/songs`, body);
      showFormMessage('Song created successfully!');
    }
    // Clear draft on successful save
    clearDraft('song', id || null);
    hideDraftBanner('songDraftBanner', 'songDraftIndicator');

    setTimeout(() => {
      closeSongModal();
      loadSongs(currentPage);
      refreshStats();
    }, 800);
  } catch (err) {
    showFormMessage(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = id ? 'Update Song' : 'Create Song';
  }
}

// Proposes an edit to an EXISTING song for Reviewer approval instead of applying it
// directly — used by Translator always, and optionally by Editor/Manager/Admin.
async function submitSongRevision() {
  const id = document.getElementById('formSongId').value;
  if (!id) return;

  const body = gatherSongFormData();
  const error = validateSongFormData(body);
  if (error) { showFormMessage(error, true); return; }

  const btn = document.getElementById('btnSubmitRevision');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    await apiPost(`${ADMIN_API}/songs/${id}/revisions`, body);
    showFormMessage('Revision submitted for review!');
    clearDraft('song', id);
    hideDraftBanner('songDraftBanner', 'songDraftIndicator');
    setTimeout(() => closeSongModal(), 800);
  } catch (err) {
    showFormMessage(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit for Revision';
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
  const canManage = hasRole(...CAN_MANAGE_REFERENCE_DATA);
  tbody.innerHTML = items.map(item => `
    <tr data-id="${item.id}">
      <td><div class="admin-table__title">${escapeHtml(item.name)}</div></td>
      <td><div class="admin-table__slug">/${type}/${escapeHtml(item.slug)}</div></td>
      <td>${escapeHtml((item.bio || '').substring(0, 60))}${item.bio && item.bio.length > 60 ? '...' : ''}</td>
      <td>
        <div class="admin-table__actions">
          ${canManage ? `<button class="btn btn--sm btn--ghost" onclick="editPerson('${type}', ${item.id})" title="Edit">✏️</button>` : ''}
          ${canManage ? `<button class="btn btn--sm btn--ghost btn--danger-text" onclick="confirmDelete(${item.id}, '${escapeHtml(item.name).replace(/'/g, "\\'")}', '${type}')" title="Delete">🗑️</button>` : ''}
          <a href="${SITE_ORIGIN}/${type}/${escapeHtml(item.slug)}" target="_blank" class="btn btn--sm btn--ghost" title="View">👁️</a>
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
  hideDraftBanner('personDraftBanner', 'personDraftIndicator');
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
  // Check for unsaved draft
  const draft = loadDraft(type, null);
  if (draft && draft.name) {
    showDraftBanner('personDraftBanner');
  }
}

async function editPerson(type, id) {
  clearPersonForm();
  const label = type === 'artist' ? 'Artist' : 'Composer';
  document.getElementById('personModalTitle').textContent = 'Edit ' + label;
  document.getElementById('personBtnSubmit').textContent = 'Update ' + label;
  document.getElementById('personFormType').value = type;
  openPersonModal();

  try {
    const item = await apiGet(`${ADMIN_API}/${type}s/${id}`);
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
    // Check for unsaved draft for this person
    const personDraft = loadDraft(type, item.id);
    if (personDraft && personDraft.name) {
      showDraftBanner('personDraftBanner');
    }
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
      await apiPut(`${ADMIN_API}/${type}s/${id}`, body);
      showPersonMessage(label + ' updated successfully!');
    } else {
      await apiPost(`${ADMIN_API}/${plural}`, body);
      showPersonMessage(label + ' created successfully!');
    }
    // Clear draft on successful save
    clearDraft(type, id || null);
    hideDraftBanner('personDraftBanner', 'personDraftIndicator');

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
  const id = deleteTargetId;
  const type = deleteTargetType;

  // 1. Close modal immediately for snappy UX
  closeDeleteModal();

  // 2. Remove row from DOM immediately (optimistic)
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) row.remove();

  // 3. Update in-memory arrays immediately
  if (type === 'song') allSongs = allSongs.filter(s => s.id !== id);
  else if (type === 'artist') allArtists = allArtists.filter(a => a.id !== id);
  else if (type === 'composer') allComposers = allComposers.filter(c => c.id !== id);
  else if (type === 'copyright-owner') allCopyrightOwners = allCopyrightOwners.filter(co => co.id !== id);
  else if (type === 'report') allReports = allReports.filter(r => r.id !== id);
  else if (type === 'admin-user') allAdminUsers = allAdminUsers.filter(u => u.id !== id);
  else if (type === 'contact') allContacts = allContacts.filter(c => c.id !== id);

  try {
    await apiDelete(`${ADMIN_API}/${type}s/${id}`);
    // Reload for accurate counts/pagination
    if (type === 'song') { loadSongs(currentPage); refreshStats(); }
    else if (type === 'artist') loadArtists();
    else if (type === 'composer') loadComposers();
    else if (type === 'report') loadReports();
    else if (type === 'copyright-owner') loadCopyrightOwners();
    else if (type === 'admin-user') loadAdminUsers();
    else if (type === 'contact') loadContacts();
  } catch (err) {
    // Show error and restore list by reloading
    if (typeof Toast !== 'undefined') {
      Toast.show('Delete failed: ' + err.message, { type: 'error', duration: 4000 });
    } else {
      alert('Delete failed: ' + err.message);
    }
    if (type === 'song') loadSongs(currentPage);
    else if (type === 'artist') loadArtists();
    else if (type === 'composer') loadComposers();
    else if (type === 'report') loadReports();
    else if (type === 'copyright-owner') loadCopyrightOwners();
    else if (type === 'admin-user') loadAdminUsers();
    else if (type === 'contact') loadContacts();
  }
}

// ═══════════════════════════════════════════════════
// ═══ ADMIN USERS (super_admin only) ═══════════════
// ═══════════════════════════════════════════════════

async function loadAdminUsers() {
  const tbody = document.getElementById('adminUsersTableBody');
  tbody.innerHTML = '<tr><td colspan="4" class="admin-table__empty">Loading...</td></tr>';
  try {
    const data = await apiGet(`${ADMIN_API}/admin-users`);
    allAdminUsers = data.admin_users || [];
    renderAdminUsersTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="admin-table__empty" style="color:var(--danger);">Failed: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderAdminUsersTable() {
  const tbody = document.getElementById('adminUsersTableBody');
  if (!allAdminUsers.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="admin-table__empty">No admin accounts found.</td></tr>';
    return;
  }
  const me = getAdminInfo();
  // A Manager may not touch an existing Admin (Super Admin) account at all — same rule the
  // backend enforces on PUT/DELETE /admin-users/:id — so hide those rows' actions client-side too.
  const canGrantSuperAdmin = hasRole('super_admin');
  tbody.innerHTML = allAdminUsers.map(u => {
    const locked = u.role === 'super_admin' && !canGrantSuperAdmin;
    return `
    <tr data-id="${u.id}">
      <td><div class="admin-table__title">${escapeHtml(u.username)}${me && me.id === u.id ? ' <span class="admin-badge" style="font-size:10px;">You</span>' : ''}</div></td>
      <td>${escapeHtml(roleLabel(u.role))}</td>
      <td>${formatDate(u.created_at)}</td>
      <td>
        <div class="admin-table__actions">
          <button class="btn btn--sm btn--ghost" onclick="openProfileModal(${u.id})" title="View Profile">👁️</button>
          ${locked ? '' : `
          <button class="btn btn--sm btn--ghost" onclick="editAdminUser(${u.id})" title="Edit">✏️</button>
          <button class="btn btn--sm btn--ghost btn--danger-text" onclick="confirmDelete(${u.id}, '${escapeHtml(u.username).replace(/'/g, "\\'")}', 'admin-user')" title="Delete">🗑️</button>
          `}
        </div>
      </td>
    </tr>
  `;
  }).join('');
}

function openAdminUserModal() {
  document.getElementById('adminUserModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeAdminUserModal() {
  document.getElementById('adminUserModal').style.display = 'none';
  document.body.style.overflow = '';
  document.getElementById('adminUserForm').reset();
  document.getElementById('auFormId').value = '';
  document.getElementById('auFormMessage').style.display = 'none';
}
function showAdminUserMessage(text, isError = false) {
  const el = document.getElementById('auFormMessage');
  el.textContent = text;
  el.className = 'form-message ' + (isError ? 'form-message--error' : 'form-message--success');
  el.style.display = 'block';
}

function openNewAdminUser() {
  closeAdminUserModal();
  document.getElementById('adminUserModalTitle').textContent = 'New Admin';
  document.getElementById('auBtnSubmit').textContent = 'Create Admin';
  document.getElementById('auFormPassword').required = true;
  document.getElementById('auPasswordRequired').style.display = 'inline';
  document.getElementById('auFormPassword').placeholder = '';
  openAdminUserModal();
  document.getElementById('auFormUsername').focus();
}

function editAdminUser(id) {
  const u = allAdminUsers.find(a => a.id === id);
  if (!u) return;
  closeAdminUserModal();
  document.getElementById('adminUserModalTitle').textContent = 'Edit Admin';
  document.getElementById('auBtnSubmit').textContent = 'Update Admin';
  document.getElementById('auFormId').value = u.id;
  document.getElementById('auFormUsername').value = u.username;
  document.getElementById('auFormRole').value = u.role;
  document.getElementById('auFormPassword').required = false;
  document.getElementById('auPasswordRequired').style.display = 'none';
  document.getElementById('auFormPassword').placeholder = 'Leave blank to keep current password';
  openAdminUserModal();
}

async function saveAdminUser(e) {
  e.preventDefault();
  const id = document.getElementById('auFormId').value;
  const username = document.getElementById('auFormUsername').value.trim();
  const password = document.getElementById('auFormPassword').value;
  const role = document.getElementById('auFormRole').value;

  if (!username) { showAdminUserMessage('Username is required.', true); return; }
  if (!id && !password) { showAdminUserMessage('Password is required.', true); return; }
  if (password && password.length < 8) { showAdminUserMessage('Password must be at least 8 characters.', true); return; }

  const btn = document.getElementById('auBtnSubmit');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const body = { username, role };
    if (password) body.password = password;

    if (id) await apiPut(`${ADMIN_API}/admin-users/${id}`, body);
    else await apiPost(`${ADMIN_API}/admin-users`, body);

    closeAdminUserModal();
    loadAdminUsers();
  } catch (err) {
    showAdminUserMessage(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = id ? 'Update Admin' : 'Create Admin';
  }
}

// ═══════════════════════════════════════════════════
// ═══ INIT ═════════════════════════════════════════
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('loginForm').addEventListener('submit', handleLogin);

  if (!getAdminToken()) {
    showLoginOverlay();
    return;
  }

  // Verify the stored session is still valid (also refreshes cached role info)
  try {
    const me = await apiGet(`${ADMIN_API}/auth/me`);
    setAdminInfo(me);
  } catch {
    clearAdminSession();
    showLoginOverlay('Session expired. Please sign in again.');
    return;
  }

  initDashboard();
});

function initDashboard() {
  applyRoleVisibility();

  document.getElementById('btnLogout').addEventListener('click', (e) => { e.preventDefault(); logout(); });
  document.getElementById('btnChangePassword').addEventListener('click', (e) => { e.preventDefault(); changePassword(); });
  document.getElementById('btnMyProfile').addEventListener('click', (e) => {
    e.preventDefault();
    const info = getAdminInfo();
    if (info) openProfileModal(info.id);
  });

  // Profile modal (view/follow any admin; self-management for your own)
  document.getElementById('profileModalClose').addEventListener('click', closeProfileModal);
  document.getElementById('profileBackdrop').addEventListener('click', closeProfileModal);
  document.getElementById('profileBtnClose').addEventListener('click', closeProfileModal);
  document.getElementById('profileBtnFollow').addEventListener('click', toggleProfileFollow);
  document.getElementById('profileBtnSaveChanges').addEventListener('click', saveProfileChanges);
  document.getElementById('profileBtnChangePassword').addEventListener('click', changePassword);
  document.getElementById('profileBtnDeleteAccount').addEventListener('click', showDeleteAccountConfirm);
  document.getElementById('profileBtnCancelDelete').addEventListener('click', cancelDeleteAccountConfirm);
  document.getElementById('profileBtnConfirmDelete').addEventListener('click', confirmDeleteAccount);

  // Admin user management (super_admin only)
  document.getElementById('btnNewAdminUser')?.addEventListener('click', openNewAdminUser);
  document.getElementById('adminUserForm')?.addEventListener('submit', saveAdminUser);
  document.getElementById('adminUserModalClose')?.addEventListener('click', closeAdminUserModal);
  document.getElementById('adminUserBackdrop')?.addEventListener('click', closeAdminUserModal);
  document.getElementById('auBtnCancel')?.addEventListener('click', closeAdminUserModal);

  // Load songs + populate dropdowns
  loadSongs();
  refreshStats();
  populateDropdowns();

  // Restore saved tab (persists across page refresh)
  const savedTab = (() => { try { return sessionStorage.getItem('admin_tab') || 'songs'; } catch { return 'songs'; } })();
  switchTab(savedTab);

  // Tab switching
  document.querySelectorAll('.admin__tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Song buttons
  document.getElementById('btnNewSong').addEventListener('click', openNewSong);
  document.getElementById('songForm').addEventListener('submit', saveSongDirect);
  document.getElementById('btnSubmitRevision').addEventListener('click', submitSongRevision);
  document.getElementById('modalClose').addEventListener('click', closeSongModal);
  document.getElementById('modalBackdrop').addEventListener('click', closeSongModal);
  document.getElementById('btnCancel').addEventListener('click', closeSongModal);

  // Artist/Composer checkbox-list filters
  wireCheckboxListFilter(document.getElementById('formArtistFilter'), document.getElementById('formArtist'));
  wireCheckboxListFilter(document.getElementById('formComposerFilter'), document.getElementById('formComposer'));

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

  // Search filter (server-side, across all songs — not just the current page)
  let searchTimer;
  document.getElementById('adminSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadSongs(1, e.target.value), 200);
  });

  // Reports filter
  document.getElementById('reportFilterStatus').addEventListener('change', () => renderReportsTable());

  // Feedback detail modal
  document.getElementById('feedbackModalClose').addEventListener('click', closeFeedbackModal);
  document.getElementById('feedbackBackdrop').addEventListener('click', closeFeedbackModal);
  document.getElementById('feedbackBtnClose').addEventListener('click', closeFeedbackModal);

  // Revisions tab + review modal
  document.getElementById('revisionFilterStatus')?.addEventListener('change', () => renderRevisionsTable());
  document.getElementById('revisionModalClose')?.addEventListener('click', closeRevisionModal);
  document.getElementById('revisionBackdrop')?.addEventListener('click', closeRevisionModal);
  document.getElementById('revisionBtnClose')?.addEventListener('click', closeRevisionModal);
  document.getElementById('revisionBtnApprove')?.addEventListener('click', approveRevision);
  document.getElementById('revisionBtnReject')?.addEventListener('click', rejectRevision);

  // Audit log filter
  document.getElementById('auditFilterTarget')?.addEventListener('change', () => loadAuditLog());

  // Feedback Inbox (contacts) filter + detail modal
  document.getElementById('contactFilterStatus')?.addEventListener('change', () => renderContactsTable());
  document.getElementById('contactModalClose')?.addEventListener('click', closeContactModal);
  document.getElementById('contactBackdrop')?.addEventListener('click', closeContactModal);
  document.getElementById('contactBtnClose')?.addEventListener('click', closeContactModal);

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

  // ── Auto-save drafts while typing ─────────────────
  ['formTitle', 'formLyrics', 'formCategory', 'formSlug'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', autoSaveSongDraft);
  });
  ['formArtist', 'formComposer', 'formCopyrightOwner'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', autoSaveSongDraft);
  });
  ['personFormName', 'personFormBio', 'personFormSlug'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', autoSavePersonDraft);
  });
  ['coFormName', 'coFormSlug', 'coFormFullLegalName', 'coFormOrganization', 'coFormTerritory', 'coFormNotes'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', autoSaveCoDraft);
  });

  // ── Draft banner: Restore / Discard buttons ────────
  document.getElementById('btnRestoreSongDraft')?.addEventListener('click', () => {
    const id = document.getElementById('formSongId').value || null;
    const draft = loadDraft('song', id);
    if (draft) restoreSongDraftData(draft);
    hideDraftBanner('songDraftBanner', 'songDraftIndicator');
  });
  document.getElementById('btnDiscardSongDraft')?.addEventListener('click', () => {
    const id = document.getElementById('formSongId').value || null;
    clearDraft('song', id);
    hideDraftBanner('songDraftBanner', 'songDraftIndicator');
  });
  document.getElementById('btnRestorePersonDraft')?.addEventListener('click', () => {
    const type = document.getElementById('personFormType').value || 'artist';
    const id = document.getElementById('personFormId').value || null;
    const draft = loadDraft(type, id);
    if (draft) restorePersonDraftData(draft);
    hideDraftBanner('personDraftBanner', 'personDraftIndicator');
  });
  document.getElementById('btnDiscardPersonDraft')?.addEventListener('click', () => {
    const type = document.getElementById('personFormType').value || 'artist';
    const id = document.getElementById('personFormId').value || null;
    clearDraft(type, id);
    hideDraftBanner('personDraftBanner', 'personDraftIndicator');
  });
  document.getElementById('btnRestoreCoDraft')?.addEventListener('click', () => {
    const id = document.getElementById('coFormId').value || null;
    const draft = loadDraft('copyright-owner', id);
    if (draft) restoreCoDraftData(draft);
    hideDraftBanner('coDraftBanner', 'coDraftIndicator');
  });
  document.getElementById('btnDiscardCoDraft')?.addEventListener('click', () => {
    const id = document.getElementById('coFormId').value || null;
    clearDraft('copyright-owner', id);
    hideDraftBanner('coDraftBanner', 'coDraftIndicator');
  });

  // Keyboard: Escape to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSongModal();
      closePersonModal();
      closeCopyrightOwnerModal();
      closeDeleteModal();
      closeFeedbackModal();
      closeRevisionModal();
      closeContactModal();
      closeProfileModal();
    }
  });
}

// Expose to inline onclick handlers
window.editSong = editSong;
window.editPerson = editPerson;
window.editAdminUser = editAdminUser;
window.editCopyrightOwner = editCopyrightOwner;
window.confirmDelete = confirmDelete;
window.loadSongs = loadSongs;
window.updateReportStatus = updateReportStatus;
window.viewFeedback = viewFeedback;
window.changeSongStatus = changeSongStatus;
window.openRevisionModal = openRevisionModal;
window.updateContactStatus = updateContactStatus;
window.viewContact = viewContact;
window.openProfileModal = openProfileModal;
window.selectAvatar = selectAvatar;

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
  const canManage = hasRole(...CAN_MANAGE_REFERENCE_DATA);
  tbody.innerHTML = items.map(item => `
    <tr data-id="${item.id}">
      <td><div class="admin-table__title">${escapeHtml(item.name)}</div></td>
      <td><div class="admin-table__slug">/copyright-owner/${escapeHtml(item.slug)}</div></td>
      <td>${escapeHtml(item.organization || '—')}</td>
      <td>${escapeHtml(item.territory || '—')}</td>
      <td>
        <div class="admin-table__actions">
          ${canManage ? `<button class="btn btn--sm btn--ghost" onclick="editCopyrightOwner(${item.id})" title="Edit">✏️</button>` : ''}
          ${canManage ? `<button class="btn btn--sm btn--ghost btn--danger-text" onclick="confirmDelete(${item.id}, '${escapeHtml(item.name).replace(/'/g, "\\'")}', 'copyright-owner')" title="Delete">🗑️</button>` : ''}
          <a href="${SITE_ORIGIN}/copyright-owner/${escapeHtml(item.slug)}" target="_blank" class="btn btn--sm btn--ghost" title="View">👁️</a>
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
  hideDraftBanner('coDraftBanner', 'coDraftIndicator');
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
  // Check for unsaved draft
  const draft = loadDraft('copyright-owner', null);
  if (draft && draft.name) {
    showDraftBanner('coDraftBanner');
  }
}

async function editCopyrightOwner(id) {
  clearCopyrightOwnerForm();
  document.getElementById('coModalTitle').textContent = 'Edit Copyright Owner';
  document.getElementById('coBtnSubmit').textContent = 'Update Copyright Owner';
  openCopyrightOwnerModal();

  try {
    const item = await apiGet(`${ADMIN_API}/copyright-owners/${id}`);
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
    // Check for unsaved draft for this copyright owner
    const coDraft = loadDraft('copyright-owner', item.id);
    if (coDraft && coDraft.name) {
      showDraftBanner('coDraftBanner');
    }
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
      await apiPut(`${ADMIN_API}/copyright-owners/${id}`, body);
      showCOMessage('Copyright owner updated successfully!');
    } else {
      await apiPost(`${ADMIN_API}/copyright-owners`, body);
      showCOMessage('Copyright owner created successfully!');
    }
    // Clear draft on successful save
    clearDraft('copyright-owner', id || null);
    hideDraftBanner('coDraftBanner', 'coDraftIndicator');

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
            ${r.song_slug ? `<a href="${SITE_ORIGIN}/song/${escapeHtml(r.song_slug)}" target="_blank" class="btn btn--sm btn--ghost" title="View Song">👁️</a>` : ''}
            <button class="btn btn--sm btn--ghost btn--danger-text" onclick="confirmDelete(${r.id}, 'Report #${r.id}', 'report')" title="Delete">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function updateReportStatus(id, status) {
  try {
    await apiPut(`${ADMIN_API}/reports/${id}`, { status });
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
    viewSongBtn.href = SITE_ORIGIN + '/song/' + r.song_slug;
    viewSongBtn.style.display = 'inline-flex';
  } else {
    viewSongBtn.style.display = 'none';
  }

  document.getElementById('feedbackModal').style.display = 'flex';
}

function closeFeedbackModal() {
  document.getElementById('feedbackModal').style.display = 'none';
}

// ═══════════════════════════════════════════════════
// ═══ REVISIONS ════════════════════════════════════
// ═══════════════════════════════════════════════════

async function loadRevisions() {
  const tbody = document.getElementById('revisionsTableBody');
  tbody.innerHTML = '<tr><td colspan="5" class="admin-table__empty">Loading...</td></tr>';
  try {
    const data = await apiGet(`${ADMIN_API}/revisions`);
    allRevisions = data.revisions || [];
    renderRevisionsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="admin-table__empty" style="color:var(--danger);">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderRevisionsTable() {
  const tbody = document.getElementById('revisionsTableBody');
  const filterEl = document.getElementById('revisionFilterStatus');
  const statusFilter = filterEl ? filterEl.value : '';

  let filtered = allRevisions;
  if (statusFilter) filtered = allRevisions.filter(r => r.status === statusFilter);

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="admin-table__empty">${statusFilter ? 'No ' + statusFilter + ' revisions.' : 'No revisions yet.'}</td></tr>`;
    return;
  }

  const statusColors = { pending: '#f59e0b', approved: '#10b981', rejected: '#ef4444' };

  tbody.innerHTML = filtered.map((r) => {
    const color = statusColors[r.status] || '#6b7280';
    return `
      <tr data-id="${r.id}">
        <td>
          <div class="admin-table__title">${escapeHtml(r.song_title || '—')}</div>
          <div class="admin-table__slug">/song/${escapeHtml(r.song_slug || '')}</div>
        </td>
        <td>${escapeHtml(r.submitted_by_username || '—')}</td>
        <td>${formatDate(r.created_at)}</td>
        <td><span class="status-badge" style="background:${color}22;color:${color};border-color:${color}44;">${escapeHtml(r.status)}</span></td>
        <td>
          <div class="admin-table__actions">
            <button class="btn btn--sm btn--ghost" onclick="openRevisionModal(${r.id})" title="Review">👁️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Plain-text before/after summary of a song's editable fields — used for both the "Current"
// and "Proposed" sides of the revision diff modal.
function describeSongFields(song) {
  if (!song) return '—';
  const artists = (song.artists || []).map(a => a.name).join(', ') || '—';
  const composers = (song.composers || []).map(c => c.name).join(', ') || '—';
  const co = song.copyright_owner_id
    ? (allCopyrightOwners.find(c => c.id === song.copyright_owner_id)?.name || `#${song.copyright_owner_id}`)
    : '—';
  return `Title: ${song.title || '—'}\nSlug: ${song.slug || '—'}\nCategory: ${song.category || '—'}\nCopyright Owner: ${co}\nArtists: ${artists}\nComposers: ${composers}\n\nLyrics:\n${song.lyrics || '—'}`;
}

async function openRevisionModal(id) {
  currentRevisionId = id;
  document.getElementById('revisionModal').style.display = 'flex';
  document.getElementById('rdSong').textContent = 'Loading...';
  document.getElementById('rdCurrent').textContent = '';
  document.getElementById('rdProposed').textContent = '';
  document.getElementById('rdNoteInput').value = '';

  try {
    const { revision, current } = await apiGet(`${ADMIN_API}/revisions/${id}`);
    document.getElementById('revisionModalTitle').textContent = `Revision #${revision.id}`;
    document.getElementById('rdSong').textContent = current ? current.title : `Song #${revision.song_id}`;
    document.getElementById('rdSubmittedBy').textContent = revision.submitted_by_username || '—';
    document.getElementById('rdSubmittedAt').textContent = formatDate(revision.created_at);
    document.getElementById('rdStatus').textContent = revision.status;

    document.getElementById('rdCurrent').textContent = describeSongFields(current);
    const proposedArtistIds = JSON.parse(revision.artist_ids || '[]');
    const proposedComposerIds = JSON.parse(revision.composer_ids || '[]');
    document.getElementById('rdProposed').textContent = describeSongFields({
      title: revision.title,
      slug: revision.slug,
      category: revision.category,
      lyrics: revision.lyrics,
      copyright_owner_id: revision.copyright_owner_id,
      artists: proposedArtistIds.map(aid => ({ name: allArtists.find(a => a.id === aid)?.name || `#${aid}` })),
      composers: proposedComposerIds.map(cid => ({ name: allComposers.find(c => c.id === cid)?.name || `#${cid}` })),
    });

    const isPending = revision.status === 'pending';
    document.getElementById('rdNoteInputRow').style.display = isPending ? 'block' : 'none';
    document.getElementById('rdNoteRow').style.display = isPending ? 'none' : 'block';
    if (!isPending) document.getElementById('rdReviewerNote').textContent = revision.reviewer_note || '—';
    document.getElementById('revisionBtnApprove').style.display = isPending ? '' : 'none';
    document.getElementById('revisionBtnReject').style.display = isPending ? '' : 'none';
  } catch (err) {
    document.getElementById('rdSong').textContent = 'Failed to load: ' + err.message;
  }
}

function closeRevisionModal() {
  document.getElementById('revisionModal').style.display = 'none';
  currentRevisionId = null;
}

async function approveRevision() {
  if (!currentRevisionId) return;
  const reviewer_note = document.getElementById('rdNoteInput').value.trim();
  try {
    await apiPut(`${ADMIN_API}/revisions/${currentRevisionId}/approve`, reviewer_note ? { reviewer_note } : {});
    if (typeof Toast !== 'undefined') Toast.show('Revision approved.', { type: 'success' });
    closeRevisionModal();
    loadRevisions();
    loadSongs(currentPage);
  } catch (err) {
    alert('Failed to approve: ' + err.message);
  }
}

async function rejectRevision() {
  if (!currentRevisionId) return;
  const reviewer_note = document.getElementById('rdNoteInput').value.trim();
  if (!reviewer_note) { alert('A reviewer note is required to reject a revision.'); return; }
  try {
    await apiPut(`${ADMIN_API}/revisions/${currentRevisionId}/reject`, { reviewer_note });
    if (typeof Toast !== 'undefined') Toast.show('Revision rejected.', { type: 'success' });
    closeRevisionModal();
    loadRevisions();
  } catch (err) {
    alert('Failed to reject: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════
// ═══ AUDIT LOG ════════════════════════════════════
// ═══════════════════════════════════════════════════

async function loadAuditLog() {
  const tbody = document.getElementById('auditLogTableBody');
  tbody.innerHTML = '<tr><td colspan="5" class="admin-table__empty">Loading...</td></tr>';
  try {
    const targetType = document.getElementById('auditFilterTarget')?.value || '';
    const params = new URLSearchParams({ limit: '100' });
    if (targetType) params.set('target_type', targetType);
    const data = await apiGet(`${ADMIN_API}/audit-log?${params.toString()}`);
    allAuditLog = data.audit_log || [];
    renderAuditLogTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="admin-table__empty" style="color:var(--danger);">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderAuditLogTable() {
  const tbody = document.getElementById('auditLogTableBody');
  if (!allAuditLog.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="admin-table__empty">No audit entries yet.</td></tr>';
    return;
  }
  tbody.innerHTML = allAuditLog.map((entry) => `
    <tr>
      <td>${formatDate(entry.created_at)}</td>
      <td>${escapeHtml(entry.admin_username || '—')}</td>
      <td>${escapeHtml(entry.action)}</td>
      <td>${escapeHtml(entry.target_type)}${entry.target_id ? ' #' + entry.target_id : ''}</td>
      <td>${escapeHtml(entry.detail || '—')}</td>
    </tr>
  `).join('');
}

// ═══════════════════════════════════════════════════
// ═══ FEEDBACK INBOX (contacts — Admin only) ═══════
// ═══════════════════════════════════════════════════

async function loadContacts() {
  const tbody = document.getElementById('contactsTableBody');
  tbody.innerHTML = '<tr><td colspan="6" class="admin-table__empty">Loading...</td></tr>';
  try {
    const data = await apiGet(`${ADMIN_API}/contacts`);
    allContacts = data.contacts || [];
    renderContactsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="admin-table__empty" style="color:var(--danger);">Failed to load: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderContactsTable() {
  const tbody = document.getElementById('contactsTableBody');
  const filterEl = document.getElementById('contactFilterStatus');
  const statusFilter = filterEl ? filterEl.value : '';

  let filtered = allContacts;
  if (statusFilter) filtered = allContacts.filter(c => c.status === statusFilter);

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="admin-table__empty">${statusFilter ? 'No ' + statusFilter + ' messages.' : 'No messages yet.'}</td></tr>`;
    return;
  }

  const statusColors = { unread: '#f59e0b', read: '#3b82f6', archived: '#6b7280' };

  tbody.innerHTML = filtered.map((c) => {
    const color = statusColors[c.status] || '#6b7280';
    const preview = (c.message || '').length > 80 ? c.message.substring(0, 80) + '...' : (c.message || '');
    return `
      <tr data-id="${c.id}">
        <td>
          <div class="admin-table__title">${escapeHtml(c.name || '—')}</div>
          <div class="admin-table__slug">${escapeHtml(c.email || '')}</div>
        </td>
        <td>${escapeHtml(c.subject || 'General')}</td>
        <td><div class="admin-table__desc" title="${escapeHtml(c.message || '')}">${escapeHtml(preview)}</div></td>
        <td>
          <select class="report-status-select" onchange="updateContactStatus(${c.id}, this.value)" style="background:${color}22;color:${color};border:1px solid ${color}44;border-radius:var(--radius-md);padding:2px 8px;font-size:var(--text-xs);font-weight:600;cursor:pointer;">
            <option value="unread" ${c.status === 'unread' ? 'selected' : ''}>Unread</option>
            <option value="read" ${c.status === 'read' ? 'selected' : ''}>Read</option>
            <option value="archived" ${c.status === 'archived' ? 'selected' : ''}>Archived</option>
          </select>
        </td>
        <td>${formatDate(c.created_at)}</td>
        <td>
          <div class="admin-table__actions">
            <button class="btn btn--sm btn--ghost" onclick="viewContact(${c.id})" title="View Detail">📝</button>
            <button class="btn btn--sm btn--ghost btn--danger-text" onclick="confirmDelete(${c.id}, 'Message #${c.id}', 'contact')" title="Delete">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function updateContactStatus(id, status) {
  try {
    await apiPut(`${ADMIN_API}/contacts/${id}`, { status });
    const contact = allContacts.find(c => c.id === id);
    if (contact) contact.status = status;
    renderContactsTable();
  } catch (err) {
    alert('Failed to update status: ' + err.message);
    loadContacts();
  }
}

function viewContact(id) {
  const c = allContacts.find(x => x.id === id);
  if (!c) return;

  const statusLabels = { unread: 'Unread', read: 'Read', archived: 'Archived' };
  const statusColors = { unread: '#f59e0b', read: '#3b82f6', archived: '#6b7280' };
  const color = statusColors[c.status] || '#6b7280';

  document.getElementById('contactModalTitle').textContent = `Message #${c.id}`;
  document.getElementById('cdName').textContent = c.name || '—';
  document.getElementById('cdEmail').innerHTML = c.email
    ? `<a href="mailto:${escapeHtml(c.email)}" style="color:var(--accent);">${escapeHtml(c.email)}</a>`
    : '—';
  document.getElementById('cdSubject').textContent = c.subject || 'General';
  document.getElementById('cdStatus').innerHTML = `<span style="color:${color};font-weight:600;">${statusLabels[c.status] || c.status}</span>`;
  document.getElementById('cdDate').textContent = formatDate(c.created_at);
  document.getElementById('cdMessage').textContent = c.message || '—';

  document.getElementById('contactModal').style.display = 'flex';
}

function closeContactModal() {
  document.getElementById('contactModal').style.display = 'none';
}

// ═══════════════════════════════════════════════════
// ═══ PROFILES (any admin can view/follow any profile;
// ═══ the owner manages avatar/username/password/deletion) ═══
// ═══════════════════════════════════════════════════

async function openProfileModal(id) {
  currentProfileId = id;
  document.getElementById('profileModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  document.getElementById('profileUsername').textContent = 'Loading...';
  document.getElementById('profileFormMessage').style.display = 'none';
  cancelDeleteAccountConfirm();

  try {
    const profile = await apiGet(`${ADMIN_API}/admin-users/${id}/profile`);
    document.getElementById('profileAvatar').textContent = avatarHtml(profile.avatar, profile.username);
    document.getElementById('profileUsername').textContent = profile.username;
    document.getElementById('profileRoleBadge').textContent = roleLabel(profile.role);
    document.getElementById('profileJoined').textContent = 'Joined ' + formatDate(profile.created_at);
    document.getElementById('profileFollowers').textContent = profile.follower_count;
    document.getElementById('profileFollowing').textContent = profile.following_count;

    currentProfileIsFollowing = !!profile.is_following;
    const followBtn = document.getElementById('profileBtnFollow');
    if (profile.is_self) {
      followBtn.style.display = 'none';
    } else {
      followBtn.style.display = '';
      followBtn.textContent = currentProfileIsFollowing ? 'Unfollow' : 'Follow';
      followBtn.className = 'btn ' + (currentProfileIsFollowing ? 'btn--ghost' : 'btn--primary');
      followBtn.style.width = '100%';
    }

    const selfSection = document.getElementById('profileSelfSection');
    selfSection.style.display = profile.is_self ? 'block' : 'none';
    if (profile.is_self) {
      document.getElementById('profileFormUsername').value = profile.username;
      selectedAvatar = profile.avatar || null;
      renderAvatarPicker();
    }
  } catch (err) {
    document.getElementById('profileUsername').textContent = 'Failed to load: ' + err.message;
  }

  loadProfileDirectory();
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
  document.body.style.overflow = '';
  currentProfileId = null;
}

function renderAvatarPicker() {
  const picker = document.getElementById('avatarPicker');
  picker.innerHTML = AVATARS.map(a => `
    <button type="button" class="avatar-picker__option${a === selectedAvatar ? ' avatar-picker__option--selected' : ''}" onclick="selectAvatar('${a}')">${a}</button>
  `).join('');
}

function selectAvatar(avatar) {
  selectedAvatar = avatar;
  renderAvatarPicker();
}

// Every role can browse this list, even roles without access to the Admins management tab —
// it's how a Viewer/Translator/Reviewer/Editor discovers other admins to view/follow at all.
async function loadProfileDirectory() {
  const listEl = document.getElementById('profileDirectoryList');
  listEl.innerHTML = '<div class="admin-table__empty">Loading...</div>';
  try {
    const data = await apiGet(`${ADMIN_API}/admin-users/directory`);
    allAdminDirectory = data.admin_users || [];
    renderProfileDirectory();
  } catch (err) {
    listEl.innerHTML = `<div class="admin-table__empty" style="color:var(--danger);">Failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

function renderProfileDirectory() {
  const listEl = document.getElementById('profileDirectoryList');
  if (!allAdminDirectory.length) {
    listEl.innerHTML = '<div class="admin-table__empty">No admins found.</div>';
    return;
  }
  listEl.innerHTML = allAdminDirectory.map(u => `
    <button type="button" class="profile-directory__item${u.id === currentProfileId ? ' profile-directory__item--active' : ''}" onclick="openProfileModal(${u.id})">
      <span class="profile-avatar profile-avatar--sm">${avatarHtml(u.avatar, u.username)}</span>
      <span class="profile-directory__name">${escapeHtml(u.username)}</span>
      <span class="profile-directory__role">${escapeHtml(roleLabel(u.role))}</span>
    </button>
  `).join('');
}

async function toggleProfileFollow() {
  if (!currentProfileId) return;
  const btn = document.getElementById('profileBtnFollow');
  btn.disabled = true;
  try {
    if (currentProfileIsFollowing) {
      await apiDelete(`${ADMIN_API}/admin-users/${currentProfileId}/follow`);
    } else {
      await apiPost(`${ADMIN_API}/admin-users/${currentProfileId}/follow`, {});
    }
    await openProfileModal(currentProfileId);
  } catch (err) {
    if (typeof Toast !== 'undefined') Toast.show('Failed: ' + err.message, { type: 'error' });
    else alert('Failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

function showProfileMessage(text, isError = false) {
  const el = document.getElementById('profileFormMessage');
  el.textContent = text;
  el.className = 'form-message ' + (isError ? 'form-message--error' : 'form-message--success');
  el.style.display = 'block';
}

async function saveProfileChanges() {
  const username = document.getElementById('profileFormUsername').value.trim();
  if (!username) { showProfileMessage('Username is required.', true); return; }

  const btn = document.getElementById('profileBtnSaveChanges');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const updated = await apiPut(`${ADMIN_API}/profile`, { username, avatar: selectedAvatar });
    showProfileMessage('Profile updated successfully!');
    // Keep the cached session info (header label, role checks) in sync with the new username.
    const info = getAdminInfo();
    if (info) setAdminInfo({ ...info, username: updated.username });
    applyRoleVisibility();
    document.getElementById('profileUsername').textContent = updated.username;
    document.getElementById('profileAvatar').textContent = avatarHtml(updated.avatar, updated.username);
    loadProfileDirectory();
  } catch (err) {
    showProfileMessage(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

function showDeleteAccountConfirm() {
  document.getElementById('profileBtnDeleteAccount').style.display = 'none';
  document.getElementById('profileDeleteConfirm').style.display = 'block';
  document.getElementById('profileDeletePassword').focus();
}

function cancelDeleteAccountConfirm() {
  document.getElementById('profileBtnDeleteAccount').style.display = '';
  document.getElementById('profileDeleteConfirm').style.display = 'none';
  document.getElementById('profileDeletePassword').value = '';
}

async function confirmDeleteAccount() {
  const password = document.getElementById('profileDeletePassword').value;
  if (!password) { alert('Enter your password to confirm.'); return; }

  const btn = document.getElementById('profileBtnConfirmDelete');
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  try {
    await apiPost(`${ADMIN_API}/profile/delete`, { password });
    clearAdminSession();
    alert('Your account has been deleted.');
    location.reload();
  } catch (err) {
    alert('Failed to delete account: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Permanently Delete My Account';
  }
}
