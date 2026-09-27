// ┌───────────────────────────────────────────────┐
// │   MaraLyrics — Admin Offline Data (IndexedDB)  │
// └───────────────────────────────────────────────┘
// Thin IndexedDB wrapper backing offline read/write for Songs + Articles.
// Artists/composers/copyright-owners are cached read-only reference data.
// `pending_changes` is the outbox: creates/edits made while offline, replayed
// against the real API once back online (see offline-sync.js).

'use strict';

const OfflineDB = (() => {
  const DB_NAME = 'maralyrics_admin';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB unsupported')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('articles')) db.createObjectStore('articles', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('artists')) db.createObjectStore('artists', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('composers')) db.createObjectStore('composers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('copyright_owners')) db.createObjectStore('copyright_owners', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pending_changes')) {
          db.createObjectStore('pending_changes', { keyPath: 'queueId', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode) {
    const db = await open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(storeName, key) {
    const store = await tx(storeName, 'readonly');
    return wrap(store.get(key));
  }

  async function getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return wrap(store.getAll());
  }

  async function put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return wrap(store.put(value));
  }

  async function putAll(storeName, values) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, 'readwrite');
      const store = t.objectStore(storeName);
      values.forEach((v) => store.put(v));
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function del(storeName, key) {
    const store = await tx(storeName, 'readwrite');
    return wrap(store.delete(key));
  }

  // ─── Pending-changes outbox ─────────────────────
  // entity: 'song' | 'article'. op: 'create' | 'update'.
  // For op:'create', `localId` identifies the not-yet-synced record (in the songs/articles
  // store) so it can be replaced once the server assigns a real id.
  // For op:'update', `remoteId` + `expectedUpdatedAt` drive the conflict check server-side.
  async function addPendingChange(change) {
    const store = await tx('pending_changes', 'readwrite');
    return wrap(store.add({ status: 'pending', createdAt: Date.now(), ...change }));
  }

  async function updatePendingChange(queueId, patch) {
    const store = await tx('pending_changes', 'readwrite');
    const existing = await wrap(store.get(queueId));
    if (!existing) return;
    return wrap(store.put({ ...existing, ...patch }));
  }

  async function deletePendingChange(queueId) {
    return del('pending_changes', queueId);
  }

  async function getPendingChanges() {
    const all = await getAll('pending_changes');
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  return {
    get, getAll, put, putAll, delete: del,
    addPendingChange, updatePendingChange, deletePendingChange, getPendingChanges,
  };
})();
