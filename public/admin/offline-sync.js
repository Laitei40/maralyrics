// ┌───────────────────────────────────────────────┐
// │   MaraLyrics — Admin Offline Sync + Install    │
// └───────────────────────────────────────────────┘
// Wires IndexedDB (offline-db.js) into the rest of the dashboard: online/offline
// detection, the sync-queue processor that replays offline writes once back online,
// conflict resolution (409 "someone else changed this" responses), and the PWA
// install prompt. index.js calls into the OfflineSync.* functions below; this file
// never touches the DOM outside the small set of elements it owns (status bar,
// conflict modal, install button).

'use strict';

const OfflineSync = (() => {
  const ENTITY_CONFIG = {
    song: { store: 'songs', apiPath: 'songs', idPrefix: 'local-song-', defaultStatus: 'pending' },
    article: { store: 'articles', apiPath: 'articles', idPrefix: 'local-article-', defaultStatus: 'draft' },
  };

  let online = navigator.onLine;
  let pendingCache = []; // in-memory mirror of OfflineDB pending_changes, kept sync-readable for table renders
  let deferredInstallPrompt = null;
  let initialized = false;
  let syncing = false;

  function isOnline() { return online; }
  function isNetworkError(err) { return err instanceof TypeError; }

  function nowIso() { return new Date().toISOString(); }
  function makeLocalId(prefix) { return prefix + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

  function notify(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  async function refreshPendingCache() {
    pendingCache = await OfflineDB.getPendingChanges();
    notify('ml:queue-changed', { pending: pendingCache });
    updateStatusIndicator();
  }

  // ─── Reference / list caching (called after successful online loads) ──
  async function cacheList(entity, rows) {
    const cfg = ENTITY_CONFIG[entity];
    // Preserve any not-yet-synced offline records already sitting in the cache —
    // a fresh online list load must not wipe out queued creates/edits.
    await OfflineDB.putAll(cfg.store, rows);
  }
  async function cacheDetail(entity, row) {
    const cfg = ENTITY_CONFIG[entity];
    const existing = await OfflineDB.get(cfg.store, row.id);
    await OfflineDB.put(cfg.store, { ...existing, ...row });
  }
  async function getCachedList(entity) {
    return OfflineDB.getAll(ENTITY_CONFIG[entity].store);
  }
  async function getCachedOne(entity, id) {
    return OfflineDB.get(ENTITY_CONFIG[entity].store, id);
  }
  async function cacheReferenceData({ artists, composers, copyright_owners }) {
    await Promise.all([
      artists ? OfflineDB.putAll('artists', artists) : Promise.resolve(),
      composers ? OfflineDB.putAll('composers', composers) : Promise.resolve(),
      copyright_owners ? OfflineDB.putAll('copyright_owners', copyright_owners) : Promise.resolve(),
    ]);
  }
  async function getCachedReferenceData() {
    const [artists, composers, copyright_owners] = await Promise.all([
      OfflineDB.getAll('artists'), OfflineDB.getAll('composers'), OfflineDB.getAll('copyright_owners'),
    ]);
    return { artists, composers, copyright_owners };
  }

  function namesFor(ids, list) {
    if (!ids || !ids.length || !list) return '';
    const byId = new Map(list.map((x) => [x.id, x.name]));
    return ids.map((id) => byId.get(Number(id))).filter(Boolean).join(', ');
  }

  // ─── Queueing offline writes ────────────────────
  // refData (optional, songs only): { artists, composers } already-loaded lists, used to
  // derive display-only artist_name/composer_name strings for the offline table row.
  async function queueCreate(entity, body, refData) {
    const cfg = ENTITY_CONFIG[entity];
    const localId = makeLocalId(cfg.idPrefix);
    const record = {
      id: localId,
      ...body,
      status: cfg.defaultStatus,
      created_at: nowIso(),
      updated_at: nowIso(),
      _offlineLocal: true,
    };
    if (entity === 'song' && refData) {
      record.artist_name = namesFor(body.artist_ids, refData.artists);
      record.composer_name = namesFor(body.composer_ids, refData.composers);
    }
    await OfflineDB.put(cfg.store, record);
    await OfflineDB.addPendingChange({ entity, op: 'create', localId, payload: body });
    await refreshPendingCache();
    return record;
  }

  async function queueUpdate(entity, id, body, expectedUpdatedAt, refData) {
    const cfg = ENTITY_CONFIG[entity];
    const isLocal = typeof id === 'string' && id.startsWith(cfg.idPrefix);
    const pending = await OfflineDB.getPendingChanges();

    if (isLocal) {
      const createEntry = pending.find((p) => p.entity === entity && p.op === 'create' && p.localId === id);
      if (!createEntry) {
        // This local id's create already synced (and its queue entry + local-id store
        // record were removed) while this edit was in flight — e.g. the sync queue ran
        // in the background while an edit modal opened against the old id was still open.
        // `id` no longer refers to anything: writing a new record under it would silently
        // orphan this edit forever (nothing would ever queue it for sync). Fail loudly
        // instead so the caller can point the admin at the now-real, already-synced record.
        const err = new Error('This record finished syncing while you were editing it — please reopen it to keep editing.');
        err.staleLocalId = true;
        throw err;
      }
      await OfflineDB.updatePendingChange(createEntry.queueId, { payload: body });
    } else {
      const existingUpdate = pending.find((p) => p.entity === entity && p.op === 'update' && p.remoteId === id && p.status !== 'conflict');
      if (existingUpdate) {
        await OfflineDB.updatePendingChange(existingUpdate.queueId, { payload: body, status: 'pending' });
      } else {
        await OfflineDB.addPendingChange({ entity, op: 'update', remoteId: id, payload: body, expectedUpdatedAt });
      }
    }

    const existing = (await OfflineDB.get(cfg.store, id)) || { id };
    const merged = { ...existing, ...body, id, _offlinePending: true };
    if (entity === 'song' && refData) {
      merged.artist_name = namesFor(body.artist_ids, refData.artists);
      merged.composer_name = namesFor(body.composer_ids, refData.composers);
    }
    await OfflineDB.put(cfg.store, merged);
    await refreshPendingCache();
    return merged;
  }

  function isPending(entity, id) {
    return pendingCache.some((p) => p.entity === entity && p.status !== 'conflict' &&
      ((p.op === 'create' && p.localId === id) || (p.op === 'update' && p.remoteId === id)));
  }
  function hasConflict(entity, id) {
    return pendingCache.some((p) => p.entity === entity && p.status === 'conflict' &&
      ((p.op === 'create' && p.localId === id) || (p.op === 'update' && p.remoteId === id)));
  }
  function pendingCount() {
    return pendingCache.filter((p) => p.status === 'pending').length;
  }
  function conflictCount() {
    return pendingCache.filter((p) => p.status === 'conflict').length;
  }
  function getConflicts() {
    return pendingCache.filter((p) => p.status === 'conflict');
  }

  // ─── Sync queue processor ───────────────────────
  // Replays queued creates/updates against the real API, in the order they were made.
  // A 409 (conflict) parks that entry with status:'conflict' instead of retrying it —
  // it waits for an explicit resolveConflict() call. Any other failure is left 'pending'
  // (network still down) so a later run picks it back up.
  async function processQueue() {
    if (syncing || !online) return;
    syncing = true;
    try {
      const queue = await OfflineDB.getPendingChanges();
      let changed = false;
      for (const item of queue) {
        if (item.status !== 'pending') continue;
        const cfg = ENTITY_CONFIG[item.entity];
        try {
          if (item.op === 'create') {
            const saved = await window.apiPost(`${ADMIN_API}/${cfg.apiPath}`, item.payload);
            await OfflineDB.delete(cfg.store, item.localId);
            await OfflineDB.put(cfg.store, saved);
            await OfflineDB.deletePendingChange(item.queueId);
          } else {
            const body = { ...item.payload, expected_updated_at: item.expectedUpdatedAt };
            const saved = await window.apiPut(`${ADMIN_API}/${cfg.apiPath}/${item.remoteId}`, body);
            await OfflineDB.put(cfg.store, saved);
            await OfflineDB.deletePendingChange(item.queueId);
          }
          changed = true;
        } catch (err) {
          if (err && err.status === 409) {
            await OfflineDB.updatePendingChange(item.queueId, { status: 'conflict', conflictCurrent: err.body && err.body.current });
            changed = true;
          } else if (isNetworkError(err)) {
            break; // back offline mid-sync — stop, the next 'online' event resumes it
          } else {
            await OfflineDB.updatePendingChange(item.queueId, { status: 'error', errorMessage: err.message });
            changed = true;
          }
        }
      }
      if (changed) {
        await refreshPendingCache();
        notify('ml:sync-complete', {});
      }
    } finally {
      syncing = false;
    }
  }

  // Records a conflict hit on a direct (online) save — same 409 shape the sync queue
  // handles, just discovered immediately instead of during a later processQueue() run.
  // Routes it through the same conflict-resolution UI so there's only one code path.
  //
  // Replaces any existing (unresolved) queue entry for this same record instead of always
  // adding a new one — without this, closing the conflict modal without resolving it and
  // then successfully editing the same record again leaves the old conflict permanently
  // stuck in the queue with a now-superseded payload, which "Keep My Edit" could later
  // silently apply over the newer, already-saved edit.
  async function recordDirectConflict(entity, remoteId, payload, expectedUpdatedAt, current) {
    const existing = pendingCache.find((p) => p.entity === entity && p.remoteId === remoteId);
    if (existing) {
      await OfflineDB.updatePendingChange(existing.queueId, {
        op: 'update', payload, expectedUpdatedAt, status: 'conflict', conflictCurrent: current,
      });
    } else {
      await OfflineDB.addPendingChange({
        entity, op: 'update', remoteId, payload, expectedUpdatedAt,
        status: 'conflict', conflictCurrent: current,
      });
    }
    await refreshPendingCache();
  }

  // Called after a direct save succeeds — clears any conflict entry left over from an
  // earlier, since-abandoned edit to this same record (see recordDirectConflict above).
  async function clearConflict(entity, remoteId) {
    const existing = pendingCache.find((p) => p.entity === entity && p.remoteId === remoteId && p.status === 'conflict');
    if (existing) {
      await OfflineDB.deletePendingChange(existing.queueId);
      await refreshPendingCache();
    }
  }

  async function resolveConflict(queueId, choice) {
    const item = pendingCache.find((p) => p.queueId === queueId);
    if (!item) return;
    const cfg = ENTITY_CONFIG[item.entity];

    if (choice === 'theirs') {
      // Discard the local edit, keep the server's version.
      if (item.conflictCurrent) await OfflineDB.put(cfg.store, item.conflictCurrent);
      await OfflineDB.deletePendingChange(item.queueId);
    } else if (choice === 'mine') {
      // Re-apply the local edit on top of the server's current state, accepting its timestamp.
      try {
        const body = { ...item.payload, expected_updated_at: item.conflictCurrent && item.conflictCurrent.updated_at };
        const saved = await window.apiPut(`${ADMIN_API}/${cfg.apiPath}/${item.remoteId}`, body);
        await OfflineDB.put(cfg.store, saved);
        await OfflineDB.deletePendingChange(item.queueId);
      } catch (err) {
        if (err && err.status === 409) {
          await OfflineDB.updatePendingChange(item.queueId, { conflictCurrent: err.body && err.body.current });
        } else {
          // Network drop, a validation error, a 404 (the record was deleted meanwhile), etc.
          // The only callers are inline onclick handlers with no .catch() of their own, so a
          // bare re-throw here used to become a silent unhandled rejection — the button
          // looked like it did nothing. Surface it instead and leave the conflict entry as-is
          // so the admin can retry.
          if (typeof Toast !== 'undefined') Toast.show('Could not apply your edit: ' + err.message, { type: 'error' });
          await refreshPendingCache();
          throw err;
        }
      }
    }
    await refreshPendingCache();
    notify('ml:sync-complete', {});
  }

  // ─── Status indicator + conflict modal (small, self-contained UI) ──
  function updateStatusIndicator() {
    const dot = document.getElementById('syncStatusDot');
    const text = document.getElementById('syncStatusText');
    const btnSync = document.getElementById('btnSyncNow');
    const conflictBtn = document.getElementById('btnViewConflicts');
    if (!dot || !text) return;

    dot.className = 'sync-status__dot ' + (online ? 'sync-status__dot--online' : 'sync-status__dot--offline');
    const pc = pendingCount();
    const cc = conflictCount();
    let label = online ? 'Online' : 'Offline';
    if (pc) label += ` · ${pc} pending sync`;
    if (cc) label += ` · ${cc} conflict${cc > 1 ? 's' : ''}`;
    text.textContent = label;

    if (btnSync) btnSync.style.display = online && pc ? '' : 'none';
    if (conflictBtn) conflictBtn.style.display = cc ? '' : 'none';
  }

  function renderConflicts() {
    const list = document.getElementById('conflictList');
    if (!list) return;
    const conflicts = getConflicts();
    if (!conflicts.length) {
      list.innerHTML = '<p class="modal__text">No conflicts.</p>';
      return;
    }
    list.innerHTML = conflicts.map((c) => {
      const server = c.conflictCurrent || {};
      const label = c.entity === 'song' ? 'Song' : 'Article';
      return `
        <div class="conflict-item">
          <div class="conflict-item__title">${label}: ${escapeHtml(c.payload.title || '')}</div>
          <div class="conflict-item__grid">
            <div>
              <div class="conflict-item__col-label">Your offline edit</div>
              <div class="conflict-item__field"><strong>Title:</strong> ${escapeHtml(c.payload.title || '')}</div>
            </div>
            <div>
              <div class="conflict-item__col-label">Current live version</div>
              <div class="conflict-item__field"><strong>Title:</strong> ${escapeHtml(server.title || '')}</div>
            </div>
          </div>
          <div class="conflict-item__actions">
            <button type="button" class="btn btn--sm btn--ghost" onclick="OfflineSync.resolveConflict(${c.queueId}, 'theirs').then(() => { OfflineSync.renderConflicts(); if (typeof loadSongs === 'function') loadSongs(currentPage); if (typeof loadArticles === 'function') loadArticles(currentArticlePage); }).catch(() => {})">Keep Live Version</button>
            <button type="button" class="btn btn--sm btn--primary" onclick="OfflineSync.resolveConflict(${c.queueId}, 'mine').then(() => { OfflineSync.renderConflicts(); if (typeof loadSongs === 'function') loadSongs(currentPage); if (typeof loadArticles === 'function') loadArticles(currentArticlePage); }).catch(() => {})">Keep My Edit</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function openConflictModal() {
    renderConflicts();
    const modal = document.getElementById('conflictModal');
    if (modal) modal.style.display = 'flex';
  }
  function closeConflictModal() {
    const modal = document.getElementById('conflictModal');
    if (modal) modal.style.display = 'none';
  }

  // Matches index.js's escapeHtml() exactly (including the apostrophe, which that file's
  // own comment explains matters for attribute contexts) — kept in sync by hand since this
  // module loads before index.js and can't import it. Only used in text-node positions
  // today (renderConflicts), but a drifted copy is a latent hazard if that ever changes.
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── Install prompt ──────────────────────────────
  function wireInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      const btn = document.getElementById('btnInstallApp');
      if (btn) btn.style.display = '';
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      const btn = document.getElementById('btnInstallApp');
      if (btn) btn.style.display = 'none';
    });
  }
  async function promptInstall() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    const btn = document.getElementById('btnInstallApp');
    if (btn) btn.style.display = 'none';
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' });
    } catch (err) {
      console.warn('Admin service worker registration failed:', err);
    }
  }

  // ─── Init ────────────────────────────────────────
  async function init() {
    if (initialized) return;
    initialized = true;

    await refreshPendingCache();
    registerServiceWorker();
    wireInstallPrompt();

    window.addEventListener('online', () => { online = true; updateStatusIndicator(); processQueue(); });
    window.addEventListener('offline', () => { online = false; updateStatusIndicator(); });

    const btnSync = document.getElementById('btnSyncNow');
    if (btnSync) btnSync.addEventListener('click', () => processQueue());
    const btnInstall = document.getElementById('btnInstallApp');
    if (btnInstall) btnInstall.addEventListener('click', () => promptInstall());
    const btnViewConflicts = document.getElementById('btnViewConflicts');
    if (btnViewConflicts) btnViewConflicts.addEventListener('click', () => openConflictModal());
    const conflictModalClose = document.getElementById('conflictModalClose');
    if (conflictModalClose) conflictModalClose.addEventListener('click', () => closeConflictModal());
    const conflictBackdrop = document.getElementById('conflictBackdrop');
    if (conflictBackdrop) conflictBackdrop.addEventListener('click', () => closeConflictModal());

    updateStatusIndicator();
    if (online) processQueue();
  }

  return {
    init, isOnline, isNetworkError,
    cacheList, cacheDetail, getCachedList, getCachedOne,
    cacheReferenceData, getCachedReferenceData,
    queueCreate, queueUpdate, isPending, hasConflict, pendingCount, conflictCount, getConflicts,
    processQueue, resolveConflict, recordDirectConflict, clearConflict,
    updateStatusIndicator, renderConflicts, openConflictModal, closeConflictModal,
    promptInstall,
  };
})();
