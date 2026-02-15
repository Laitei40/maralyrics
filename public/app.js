// ╔══════════════════════════════════════════════════════════════╗
// ║        MaraLyrics — Client-Side Application                 ║
// ║        Vanilla JS · Modular · Offline-Ready                 ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

// ─── Configuration ─────────────────────────────────────────────
const WORKER_ORIGIN = 'https://maralyrics.teiteipara.workers.dev';
const API_ORIGIN = window.location.hostname.endsWith('pages.dev') ? WORKER_ORIGIN : '';
const CONFIG = {
  API_BASE: `${API_ORIGIN}/api`,
  CACHE_PREFIX: 'ml_',
  CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours
  SEARCH_DEBOUNCE: 300,
  ITEMS_PER_PAGE: 20,
  POPULAR_LIMIT: 6,
  VIEW_COOLDOWN: 60 * 60 * 1000, // 1 hour
};

// ─── Utility Module ────────────────────────────────────────────
const Utils = {
  /** Escape HTML to prevent XSS. */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /** Debounce function calls. */
  debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  /** Format view count (e.g., 1234 → "1.2K"). */
  formatViews(n) {
    if (!n || n < 1000) return String(n || 0);
    if (n < 1000000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  },

  /** Check if device is online. */
  isOnline() {
    return navigator.onLine;
  },

  /** Get slug from current URL path. */
  getSlugFromUrl() {
    const path = window.location.pathname;
    const match = path.match(/\/(song|artist|composer|copyright-owner)\/([^/]+)/);
    return match ? match[2] : null;
  },

  /** Get page type from current URL path. */
  getPageType() {
    const path = window.location.pathname;
    if (path.startsWith('/song/')) return 'song';
    if (path.startsWith('/artist/')) return 'artist';
    if (path.startsWith('/composer/')) return 'composer';
    if (path.startsWith('/copyright-owner/')) return 'copyright-owner';
    return 'home';
  },

  /** Create a clickable name link or a disabled span for unknown. */
  renderNameLink(name, slug, type) {
    if (name && slug) {
      const href = `/${type}/${this.escapeHtml(slug)}`;
      return `<a href="${href}" class="meta-link">${this.escapeHtml(name)}</a>`;
    }
    return `<span class="meta-link meta-link--disabled">${this.escapeHtml(name || I18n.t('common.unknown'))}</span>`;
  },

  /** Detect social platform from URL and return name + SVG icon. */
  detectSocialPlatform(url) {
    const platforms = [
      { pattern: /facebook\.com|fb\.com/i,    name: 'Facebook',   icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' },
      { pattern: /twitter\.com|x\.com/i,      name: 'X',          icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' },
      { pattern: /instagram\.com/i,           name: 'Instagram',  icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>' },
      { pattern: /youtube\.com|youtu\.be/i,   name: 'YouTube',    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>' },
      { pattern: /tiktok\.com/i,              name: 'TikTok',     icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>' },
      { pattern: /spotify\.com/i,             name: 'Spotify',    icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>' },
      { pattern: /soundcloud\.com/i,          name: 'SoundCloud', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c-.009-.06-.05-.1-.1-.1z"/></svg>' },
    ];
    for (const p of platforms) {
      if (p.pattern.test(url)) return p;
    }
    return { name: I18n.t('common.website'), icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>' };
  },
};

// ─── Cache Module (localStorage + cookies) ─────────────────────
const Cache = {
  /** Save data to localStorage with timestamp. */
  set(key, data) {
    try {
      const entry = {
        data,
        timestamp: Date.now(),
      };
      localStorage.setItem(CONFIG.CACHE_PREFIX + key, JSON.stringify(entry));
    } catch (e) {
      // Storage full — clear oldest entries
      this._cleanup();
    }
  },

  /** Retrieve from localStorage if not expired. */
  get(key) {
    try {
      const raw = localStorage.getItem(CONFIG.CACHE_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.timestamp > CONFIG.CACHE_TTL) {
        localStorage.removeItem(CONFIG.CACHE_PREFIX + key);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  },

  /** Save minimal metadata to cookies (for quick offline detection). */
  setCookie(name, value, hours = 24) {
    const expires = new Date(Date.now() + hours * 60 * 60 * 1000).toUTCString();
    document.cookie = `${CONFIG.CACHE_PREFIX}${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
  },

  /** Read a cookie value. */
  getCookie(name) {
    const match = document.cookie.match(
      new RegExp('(?:^|; )' + CONFIG.CACHE_PREFIX + name + '=([^;]*)')
    );
    return match ? decodeURIComponent(match[1]) : null;
  },

  /** Save a song to the offline cache. */
  cacheSong(song) {
    if (!song?.slug) return;
    // Full data in localStorage
    this.set('song_' + song.slug, song);
    // Minimal reference in cookies
    const visited = JSON.parse(this.getCookie('visited') || '[]');
    if (!visited.includes(song.slug)) {
      visited.push(song.slug);
      // Keep last 50
      if (visited.length > 50) visited.shift();
      this.setCookie('visited', JSON.stringify(visited));
    }
  },

  /** Get a cached song. */
  getCachedSong(slug) {
    return this.get('song_' + slug);
  },

  /** Cache song list. */
  cacheSongList(page, category, data) {
    const key = `list_${page}_${category || 'all'}`;
    this.set(key, data);
  },

  /** Get cached song list. */
  getCachedSongList(page, category) {
    const key = `list_${page}_${category || 'all'}`;
    return this.get(key);
  },

  /** Check view cooldown. */
  canCountView(slug) {
    const lastView = this.getCookie('view_' + slug);
    if (lastView && Date.now() - parseInt(lastView, 10) < CONFIG.VIEW_COOLDOWN) {
      return false;
    }
    return true;
  },

  /** Mark view as counted. */
  markViewCounted(slug) {
    this.setCookie('view_' + slug, String(Date.now()), 1);
  },

  /** Remove old entries when storage is full. */
  _cleanup() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(CONFIG.CACHE_PREFIX)) {
        try {
          const entry = JSON.parse(localStorage.getItem(k));
          keys.push({ key: k, ts: entry.timestamp || 0 });
        } catch {
          localStorage.removeItem(k);
        }
      }
    }
    // Remove oldest half
    keys.sort((a, b) => a.ts - b.ts);
    const toRemove = keys.slice(0, Math.ceil(keys.length / 2));
    toRemove.forEach((k) => localStorage.removeItem(k.key));
  },
};

// ─── API Module ────────────────────────────────────────────────
const API = {
  /** Generic JSON fetch with error handling. */
  async fetchJSON(endpoint) {
    const res = await fetch(CONFIG.API_BASE + endpoint);
    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
    return res.json();
  },

  /** Get paginated song list. */
  async getSongs(page = 1, category = null) {
    let url = `/songs?page=${page}&limit=${CONFIG.ITEMS_PER_PAGE}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    return this.fetchJSON(url);
  },

  /** Get single song by slug. */
  async getSong(slug) {
    return this.fetchJSON(`/song/${encodeURIComponent(slug)}`);
  },

  /** Search songs. */
  async search(query) {
    return this.fetchJSON(`/search?q=${encodeURIComponent(query)}`);
  },

  /** Get categories. */
  async getCategories() {
    return this.fetchJSON('/categories');
  },

  /** Get popular songs. */
  async getPopular() {
    return this.fetchJSON(`/popular?limit=${CONFIG.POPULAR_LIMIT}`);
  },

  /** Increment view count. */
  async incrementView(slug) {
    return fetch(`${CONFIG.API_BASE}/view/${encodeURIComponent(slug)}`, {
      method: 'POST',
    });
  },

  /** Get copyright owner by slug. */
  async getCopyrightOwner(slug) {
    return this.fetchJSON(`/copyright-owner/${encodeURIComponent(slug)}`);
  },

  /** Get artist by slug. */
  async getArtist(slug) {
    return this.fetchJSON(`/artist/${encodeURIComponent(slug)}`);
  },

  /** Get composer by slug. */
  async getComposer(slug) {
    return this.fetchJSON(`/composer/${encodeURIComponent(slug)}`);
  },
};

// ─── UI Rendering Module ───────────────────────────────────────
const UI = {
  /** Create a song card HTML string. */
  createSongCard(song, index = 0) {
    const delay = Math.min(index * 60, 600);
    return `
      <a href="/song/${Utils.escapeHtml(song.slug)}"
         class="song-card stagger-enter"
         style="animation-delay:${delay}ms"
         data-slug="${Utils.escapeHtml(song.slug)}">
        <h3 class="song-card__title">${Utils.escapeHtml(song.title)}</h3>
        <p class="song-card__artist">${Utils.escapeHtml(song.artist_name || song.artist || I18n.t('common.unknown_artist'))}</p>
        <div class="song-card__meta">
          ${song.category ? `<span class="song-card__category">${Utils.escapeHtml(song.category)}</span>` : '<span></span>'}
          <span class="song-card__views">👁 ${Utils.formatViews(song.views)}</span>
        </div>
      </a>`;
  },

  /** Create skeleton loading cards. */
  createSkeletons(count = 6) {
    return Array(count)
      .fill('')
      .map(
        () => `
      <div class="skeleton">
        <div class="skeleton__line skeleton__line--title"></div>
        <div class="skeleton__line skeleton__line--short"></div>
        <div class="skeleton__line skeleton__line--medium" style="margin-top:var(--space-md)"></div>
      </div>`
      )
      .join('');
  },

  /** Render pagination controls. */
  createPagination(page, totalPages) {
    if (totalPages <= 1) return '';

    let html = '';

    // Previous button
    html += `<button class="pagination__btn" ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">${I18n.t('common.prev')}</button>`;

    // Page numbers
    const range = 2;
    const start = Math.max(1, page - range);
    const end = Math.min(totalPages, page + range);

    if (start > 1) {
      html += `<button class="pagination__btn" data-page="1">1</button>`;
      if (start > 2) html += `<span class="pagination__info">...</span>`;
    }

    for (let i = start; i <= end; i++) {
      html += `<button class="pagination__btn ${i === page ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    if (end < totalPages) {
      if (end < totalPages - 1) html += `<span class="pagination__info">...</span>`;
      html += `<button class="pagination__btn" data-page="${totalPages}">${totalPages}</button>`;
    }

    // Next button
    html += `<button class="pagination__btn" ${page >= totalPages ? 'disabled' : ''} data-page="${page + 1}">${I18n.t('common.next')}</button>`;

    return html;
  },

  /** Show/hide the offline badge. */
  setOfflineMode(offline) {
    const badge = document.getElementById('offlineBadge');
    if (badge) {
      badge.classList.toggle('visible', offline);
    }
  },

  /** Show empty state. */
  showEmptyState(show = true) {
    const el = document.getElementById('emptyState');
    if (el) el.style.display = show ? 'block' : 'none';
  },
};

// ─── Home Page Controller ──────────────────────────────────────
const HomePage = {
  currentPage: 1,
  currentCategory: null,

  async init() {
    this.bindElements();
    this.bindEvents();
    await Promise.all([
      this.loadCategories(),
      this.loadPopular(),
      this.loadSongs(),
    ]);
  },

  bindElements() {
    this.searchInput = document.getElementById('searchInput');
    this.searchClear = document.getElementById('searchClear');
    this.categoriesEl = document.getElementById('categories');
    this.songGrid = document.getElementById('songGrid');
    this.popularGrid = document.getElementById('popularGrid');
    this.searchGrid = document.getElementById('searchGrid');
    this.searchResults = document.getElementById('searchResults');
    this.searchCount = document.getElementById('searchCount');
    this.popularSection = document.getElementById('popularSection');
    this.allSongsSection = document.getElementById('allSongsSection');
    this.paginationEl = document.getElementById('pagination');
  },

  bindEvents() {
    // Search with debounce
    if (this.searchInput) {
      const debouncedSearch = Utils.debounce(
        (e) => this.handleSearch(e.target.value),
        CONFIG.SEARCH_DEBOUNCE
      );
      this.searchInput.addEventListener('input', (e) => {
        this.searchClear.classList.toggle('visible', e.target.value.length > 0);
        debouncedSearch(e);
      });
    }

    // Clear search
    if (this.searchClear) {
      this.searchClear.addEventListener('click', () => {
        this.searchInput.value = '';
        this.searchClear.classList.remove('visible');
        this.clearSearch();
        this.searchInput.focus();
      });
    }

    // Category filter (event delegation)
    if (this.categoriesEl) {
      this.categoriesEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.category-btn');
        if (!btn) return;
        const cat = btn.dataset.category;
        this.currentCategory = cat === this.currentCategory ? null : cat;
        this.currentPage = 1;
        this.updateCategoryButtons();
        this.loadSongs();
      });
    }

    // Pagination (event delegation)
    if (this.paginationEl) {
      this.paginationEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.pagination__btn');
        if (!btn || btn.disabled) return;
        this.currentPage = parseInt(btn.dataset.page, 10);
        this.loadSongs();
        window.scrollTo({ top: this.allSongsSection.offsetTop - 80, behavior: 'smooth' });
      });
    }
  },

  // ─── Load Categories ─────────────────────────────────
  async loadCategories() {
    if (!this.categoriesEl) return;
    try {
      let data;
      if (Utils.isOnline()) {
        data = await API.getCategories();
        Cache.set('categories', data.categories);
      } else {
        data = { categories: Cache.get('categories') || [] };
      }

      const allBtn = `<button class="category-btn active" data-category="">${I18n.t('common.all')}</button>`;
      const catBtns = data.categories
        .map((c) => `<button class="category-btn" data-category="${Utils.escapeHtml(c)}">${Utils.escapeHtml(c)}</button>`)
        .join('');

      this.categoriesEl.innerHTML = allBtn + catBtns;
    } catch (err) {
      console.warn('Failed to load categories:', err);
    }
  },

  updateCategoryButtons() {
    if (!this.categoriesEl) return;
    this.categoriesEl.querySelectorAll('.category-btn').forEach((btn) => {
      const cat = btn.dataset.category;
      const isActive =
        (!this.currentCategory && cat === '') ||
        cat === this.currentCategory;
      btn.classList.toggle('active', isActive);
    });
  },

  // ─── Load Popular Songs ──────────────────────────────
  async loadPopular() {
    if (!this.popularGrid) return;
    this.popularGrid.innerHTML = UI.createSkeletons(CONFIG.POPULAR_LIMIT);

    try {
      let songs;
      if (Utils.isOnline()) {
        const data = await API.getPopular();
        songs = data.songs;
        Cache.set('popular', songs);
      } else {
        songs = Cache.get('popular') || [];
      }

      if (songs.length === 0) {
        this.popularSection.style.display = 'none';
        return;
      }

      this.popularGrid.innerHTML = songs
        .map((s, i) => UI.createSongCard(s, i))
        .join('');
    } catch (err) {
      console.warn('Failed to load popular songs:', err);
      const cached = Cache.get('popular');
      if (cached?.length) {
        this.popularGrid.innerHTML = cached.map((s, i) => UI.createSongCard(s, i)).join('');
      } else {
        this.popularSection.style.display = 'none';
      }
    }
  },

  // ─── Load All Songs (Paginated) ──────────────────────
  async loadSongs() {
    if (!this.songGrid) return;
    this.songGrid.innerHTML = UI.createSkeletons(6);
    this.paginationEl.innerHTML = '';

    try {
      let data;
      if (Utils.isOnline()) {
        data = await API.getSongs(this.currentPage, this.currentCategory);
        Cache.cacheSongList(this.currentPage, this.currentCategory, data);
      } else {
        data = Cache.getCachedSongList(this.currentPage, this.currentCategory);
        if (!data) {
          UI.showEmptyState(true);
          this.songGrid.innerHTML = '';
          return;
        }
        UI.setOfflineMode(true);
      }

      UI.showEmptyState(false);

      if (!data.songs?.length) {
        this.songGrid.innerHTML = '';
        UI.showEmptyState(true);
        return;
      }

      this.songGrid.innerHTML = data.songs
        .map((s, i) => UI.createSongCard(s, i))
        .join('');

      this.paginationEl.innerHTML = UI.createPagination(data.page, data.totalPages);
    } catch (err) {
      console.warn('Failed to load songs:', err);
      // Try cache fallback
      const cached = Cache.getCachedSongList(this.currentPage, this.currentCategory);
      if (cached?.songs?.length) {
        this.songGrid.innerHTML = cached.songs.map((s, i) => UI.createSongCard(s, i)).join('');
        this.paginationEl.innerHTML = UI.createPagination(cached.page, cached.totalPages);
        UI.setOfflineMode(true);
      } else {
        this.songGrid.innerHTML = '';
        UI.showEmptyState(true);
      }
    }
  },

  // ─── Search Handler ──────────────────────────────────
  async handleSearch(query) {
    const q = query.trim();

    if (!q) {
      this.clearSearch();
      return;
    }

    // Show search section, hide others
    this.searchResults.style.display = 'block';
    this.popularSection.style.display = 'none';
    this.allSongsSection.style.display = 'none';
    UI.showEmptyState(false);

    this.searchGrid.innerHTML = UI.createSkeletons(3);

    try {
      let results;
      if (Utils.isOnline()) {
        const data = await API.search(q);
        results = data.results;
        Cache.set('search_' + q.toLowerCase(), results);
      } else {
        // Offline: search from cached data
        results = this._offlineSearch(q);
        UI.setOfflineMode(true);
      }

      this.searchCount.textContent = I18n.t('common.found', { count: results.length });

      if (results.length === 0) {
        this.searchGrid.innerHTML = '';
        UI.showEmptyState(true);
        return;
      }

      this.searchGrid.innerHTML = results
        .map((s, i) => UI.createSongCard(s, i))
        .join('');
    } catch (err) {
      console.warn('Search failed:', err);
      const cached = Cache.get('search_' + q.toLowerCase());
      if (cached?.length) {
        this.searchGrid.innerHTML = cached.map((s, i) => UI.createSongCard(s, i)).join('');
        this.searchCount.textContent = I18n.t('common.cached', { count: cached.length });
        UI.setOfflineMode(true);
      } else {
        const offline = this._offlineSearch(q);
        if (offline.length) {
          this.searchGrid.innerHTML = offline.map((s, i) => UI.createSongCard(s, i)).join('');
          this.searchCount.textContent = I18n.t('common.cached', { count: offline.length });
        } else {
          this.searchGrid.innerHTML = '';
          UI.showEmptyState(true);
        }
      }
    }
  },

  /** Search through locally cached songs. */
  _offlineSearch(query) {
    const q = query.toLowerCase();
    const results = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(CONFIG.CACHE_PREFIX + 'song_')) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key));
        const song = entry.data;
        if (
          song.title?.toLowerCase().includes(q) ||
          song.artist_name?.toLowerCase().includes(q) ||
          song.artist?.toLowerCase().includes(q)
        ) {
          results.push(song);
        }
      } catch { /* skip */ }
    }
    return results;
  },

  /** Clear search results and restore normal view. */
  clearSearch() {
    if (this.searchResults) this.searchResults.style.display = 'none';
    if (this.popularSection) this.popularSection.style.display = 'block';
    if (this.allSongsSection) this.allSongsSection.style.display = 'block';
    UI.showEmptyState(false);
  },
};

// ─── Song Page Controller ──────────────────────────────────────
const SongPage = {
  async init() {
    const slug = Utils.getSlugFromUrl();
    if (!slug) {
      this.showError();
      return;
    }

    await this.loadSong(slug);
  },

  async loadSong(slug) {
    try {
      let song;

      if (Utils.isOnline()) {
        song = await API.getSong(slug);
        // Cache for offline
        Cache.cacheSong(song);
      } else {
        song = Cache.getCachedSong(slug);
        if (!song) {
          this.showError();
          return;
        }
        UI.setOfflineMode(true);
      }

      this.renderSong(song);
      this.updateMeta(song);
      this.countView(slug);
    } catch (err) {
      console.warn('Failed to load song:', err);
      // Try cached version
      const cached = Cache.getCachedSong(slug);
      if (cached) {
        this.renderSong(cached);
        this.updateMeta(cached);
        UI.setOfflineMode(true);
      } else {
        this.showError();
      }
    }
  },

  renderSong(song) {
    const skeleton = document.getElementById('songSkeleton');
    const detail = document.getElementById('songDetail');
    const error = document.getElementById('songError');

    if (skeleton) skeleton.style.display = 'none';
    if (error) error.style.display = 'none';
    if (detail) detail.style.display = 'block';

    const titleEl = document.getElementById('songTitle');
    const artistEl = document.getElementById('songArtist');
    const categoryEl = document.getElementById('songCategory');
    const viewsEl = document.getElementById('songViews');
    const lyricsEl = document.getElementById('songLyrics');

    if (titleEl) titleEl.textContent = song.title;
    if (artistEl) artistEl.innerHTML = Utils.renderNameLink(song.artist_name || song.artist, song.artist_slug, 'artist');
    const composerEl = document.getElementById('songComposer');
    if (composerEl) composerEl.innerHTML = Utils.renderNameLink(song.composer_name || song.composer, song.composer_slug, 'composer');
    if (categoryEl) categoryEl.textContent = song.category || I18n.t('common.uncategorized');
    if (viewsEl) viewsEl.textContent = Utils.formatViews(song.views);

    // Copyright owner (only show if present — displayed at footer of song card)
    const coWrap = document.getElementById('songCopyrightOwnerWrap');
    const coEl = document.getElementById('songCopyrightOwner');
    if (coWrap && coEl) {
      if (song.copyright_owner_name) {
        coEl.innerHTML = Utils.renderNameLink(song.copyright_owner_name, song.copyright_owner_slug, 'copyright-owner');
        coWrap.style.display = 'flex';
      } else {
        coWrap.style.display = 'none';
      }
    }

    // Update breadcrumb
    const breadcrumbTitle = document.getElementById('breadcrumbTitle');
    if (breadcrumbTitle) breadcrumbTitle.textContent = song.title;

    if (lyricsEl) {
      // Replace literal \n with actual newlines (D1 may store escaped newlines)
      const cleanLyrics = (song.lyrics || '').replace(/\\n/g, '\n');
      lyricsEl.textContent = cleanLyrics;
    }

    // Feedback button — build link with song context
    const reportBtn = document.getElementById('btnReportError');
    if (reportBtn) {
      const params = new URLSearchParams({
        song: song.slug || '',
        title: song.title || '',
        artist: song.artist_name || song.artist || '',
      });
      reportBtn.href = '/report?' + params.toString();
    }
  },

  /** Update page title, meta tags, and JSON-LD. */
  updateMeta(song) {
    const title = `${song.title} — MaraLyrics`;
    const artistDisplay = song.artist_name || song.artist || 'Unknown';
    const desc = `Read lyrics of "${song.title}" by ${artistDisplay} on MaraLyrics.`;

    document.title = title;

    const metaDesc = document.getElementById('metaDesc');
    if (metaDesc) metaDesc.content = desc;

    const ogTitle = document.getElementById('ogTitle');
    if (ogTitle) ogTitle.content = title;

    const ogDesc = document.getElementById('ogDesc');
    if (ogDesc) ogDesc.content = desc;

    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = title;

    // JSON-LD structured data
    const jsonLd = document.getElementById('jsonLd');
    if (jsonLd) {
      jsonLd.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'MusicComposition',
        name: song.title,
        composer: song.composer_name || song.composer || 'Unknown',
        lyricist: artistDisplay,
        genre: song.category || 'Mara',
        text: song.lyrics?.substring(0, 200),
        url: window.location.href,
      });
    }
  },

  /** Increment view (with cooldown). */
  async countView(slug) {
    if (!Utils.isOnline()) return;
    if (!Cache.canCountView(slug)) return;

    try {
      await API.incrementView(slug);
      Cache.markViewCounted(slug);
    } catch (err) {
      console.warn('View count failed:', err);
    }
  },

  showError() {
    const skeleton = document.getElementById('songSkeleton');
    const detail = document.getElementById('songDetail');
    const error = document.getElementById('songError');

    if (skeleton) skeleton.style.display = 'none';
    if (detail) detail.style.display = 'none';
    if (error) error.style.display = 'block';
  },
};

// ─── Profile Page Controller (Artist / Composer) ───────────────
const ProfilePage = {
  type: 'artist', // or 'composer'

  async init(type) {
    this.type = type;
    const slug = Utils.getSlugFromUrl();
    if (!slug) {
      this.showError();
      return;
    }
    await this.loadProfile(slug);
  },

  async loadProfile(slug) {
    try {
      let data;
      const cacheKey = `${this.type}_${slug}`;

      if (Utils.isOnline()) {
        data = this.type === 'artist'
          ? await API.getArtist(slug)
          : await API.getComposer(slug);
        Cache.set(cacheKey, data);
      } else {
        data = Cache.get(cacheKey);
        if (!data) {
          this.showError();
          return;
        }
        UI.setOfflineMode(true);
      }

      this.renderProfile(data);
      this.updateMeta(data);
    } catch (err) {
      console.warn(`Failed to load ${this.type}:`, err);
      const cached = Cache.get(`${this.type}_${slug}`);
      if (cached) {
        this.renderProfile(cached);
        this.updateMeta(cached);
        UI.setOfflineMode(true);
      } else {
        this.showError();
      }
    }
  },

  renderProfile(data) {
    const skeleton = document.getElementById('profileSkeleton');
    const detail = document.getElementById('profileDetail');
    const error = document.getElementById('profileError');

    if (skeleton) skeleton.style.display = 'none';
    if (error) error.style.display = 'none';
    if (detail) detail.style.display = 'block';

    // Name
    const nameEl = document.getElementById('profileName');
    if (nameEl) nameEl.textContent = data.name;

    // Update "Songs by {name}" section title
    const songsTitleEl = document.getElementById('songsSectionTitle');
    if (songsTitleEl && data.name) {
      const prefix = songsTitleEl.getAttribute('data-prefix') || 'Songs by';
      songsTitleEl.textContent = `${prefix} ${data.name}`;
    }

    // Breadcrumb
    const breadcrumbEl = document.getElementById('breadcrumbName');
    if (breadcrumbEl) breadcrumbEl.textContent = data.name;

    // Avatar fallback (initials)
    const avatarEl = document.getElementById('profileAvatar');
    const fallbackEl = document.getElementById('avatarFallback');
    if (data.image_url && avatarEl) {
      avatarEl.innerHTML = `<img src="${Utils.escapeHtml(data.image_url)}" alt="${Utils.escapeHtml(data.name)}" class="profile-page__avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="profile-page__avatar-fallback" style="display:none;">${Utils.escapeHtml(data.name?.charAt(0) || '?')}</span>`;
    } else if (fallbackEl) {
      fallbackEl.textContent = data.name?.charAt(0) || '?';
    }

    // Bio
    const bioEl = document.getElementById('profileBio');
    if (bioEl) {
      bioEl.textContent = data.bio || '';
      bioEl.style.display = data.bio ? 'block' : 'none';
    }

    // Social links
    const socialEl = document.getElementById('profileSocial');
    if (socialEl && data.social_links) {
      try {
        const links = JSON.parse(data.social_links);
        if (Array.isArray(links) && links.length) {
          socialEl.innerHTML = links.map(url => {
            const p = Utils.detectSocialPlatform(url);
            return `<a href="${Utils.escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="social-icon" title="${Utils.escapeHtml(p.name)}">${p.icon}</a>`;
          }).join('');
          socialEl.style.display = 'flex';
        } else {
          socialEl.style.display = 'none';
        }
      } catch { socialEl.style.display = 'none'; }
    } else if (socialEl) {
      socialEl.style.display = 'none';
    }

    // Songs
    const songGrid = document.getElementById('profileSongGrid');
    const emptyEl = document.getElementById('profileEmpty');
    const countEl = document.getElementById('songCount');
    const songs = data.songs || [];

    if (countEl) countEl.textContent = `(${songs.length})`;

    if (songs.length === 0) {
      if (songGrid) songGrid.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
    } else {
      if (emptyEl) emptyEl.style.display = 'none';
      if (songGrid) {
        songGrid.innerHTML = songs.map((s, i) => UI.createSongCard(s, i)).join('');
      }
    }
  },

  updateMeta(data) {
    const typeLabel = this.type === 'artist' ? 'Artist' : 'Composer';
    const title = `${data.name} — ${typeLabel} — MaraLyrics`;
    const songCount = data.songs?.length || 0;
    const desc = `${data.name} — ${typeLabel} on MaraLyrics. ${songCount} song${songCount !== 1 ? 's' : ''}.${data.bio ? ' ' + data.bio.substring(0, 120) : ''}`;

    document.title = title;

    const metaDesc = document.getElementById('metaDesc');
    if (metaDesc) metaDesc.content = desc;

    const ogTitle = document.getElementById('ogTitle');
    if (ogTitle) ogTitle.content = title;

    const ogDesc = document.getElementById('ogDesc');
    if (ogDesc) ogDesc.content = desc;

    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = title;

    const jsonLd = document.getElementById('jsonLd');
    if (jsonLd) {
      jsonLd.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': this.type === 'artist' ? 'MusicGroup' : 'Person',
        name: data.name,
        description: data.bio || '',
        url: window.location.href,
      });
    }
  },

  showError() {
    const skeleton = document.getElementById('profileSkeleton');
    const detail = document.getElementById('profileDetail');
    const error = document.getElementById('profileError');

    if (skeleton) skeleton.style.display = 'none';
    if (detail) detail.style.display = 'none';
    if (error) error.style.display = 'block';
  },
};

// ─── Copyright Owner Page Controller ───────────────────────────
const CopyrightOwnerPage = {
  async init() {
    const slug = Utils.getSlugFromUrl();
    if (!slug) {
      this.showError();
      return;
    }
    await this.loadOwner(slug);
  },

  async loadOwner(slug) {
    try {
      let data;
      const cacheKey = `copyright_owner_${slug}`;

      if (Utils.isOnline()) {
        data = await API.getCopyrightOwner(slug);
        Cache.set(cacheKey, data);
      } else {
        data = Cache.get(cacheKey);
        if (!data) { this.showError(); return; }
        UI.setOfflineMode(true);
      }

      this.render(data);
      this.updateMeta(data);
    } catch (err) {
      console.warn('Failed to load copyright owner:', err);
      const cached = Cache.get(`copyright_owner_${slug}`);
      if (cached) {
        this.render(cached);
        this.updateMeta(cached);
        UI.setOfflineMode(true);
      } else {
        this.showError();
      }
    }
  },

  render(data) {
    const skeleton = document.getElementById('profileSkeleton');
    const detail = document.getElementById('profileDetail');
    const error = document.getElementById('profileError');

    if (skeleton) skeleton.style.display = 'none';
    if (error) error.style.display = 'none';
    if (detail) detail.style.display = 'block';

    // Name & breadcrumb
    const nameEl = document.getElementById('profileName');
    if (nameEl) nameEl.textContent = data.owner?.name || data.name || '';

    const breadcrumbEl = document.getElementById('breadcrumbName');
    if (breadcrumbEl) breadcrumbEl.textContent = data.owner?.name || data.name || '';

    const owner = data.owner || data;

    // Avatar fallback (© icon)
    const avatarEl = document.getElementById('profileAvatar');
    if (avatarEl) {
      avatarEl.innerHTML = '<span class="profile-page__avatar-fallback" style="font-size:2rem;">©</span>';
    }

    // Role label
    const roleEl = document.querySelector('.profile-page__role');
    if (roleEl) roleEl.textContent = 'Copyright Owner';

    // Hide social links section
    const socialEl = document.getElementById('profileSocial');
    if (socialEl) socialEl.style.display = 'none';

    // Bio area becomes copyright info
    const bioEl = document.getElementById('profileBio');
    if (bioEl) {
      bioEl.style.display = 'none';
    }

    // Copyright details section
    const infoContainer = document.getElementById('copyrightInfoSection');
    if (infoContainer) {
      let html = '';
      const fields = [
        { label: 'Full Legal Name', value: owner.full_legal_name },
        { label: 'Organization / Publisher', value: owner.organization },
        { label: 'Territory / Jurisdiction', value: owner.territory },
        { label: 'Email', value: owner.email, isEmail: true },
        { label: 'Website', value: owner.website, isUrl: true },
        { label: 'Address', value: owner.address },
        { label: 'IPI Number', value: owner.ipi_number },
        { label: 'ISRC Prefix', value: owner.isrc_prefix },
        { label: 'PRO Affiliation', value: owner.pro_affiliation },
      ];

      const visibleFields = fields.filter(f => f.value);
      if (visibleFields.length) {
        html += '<div class="copyright-info">';
        visibleFields.forEach(f => {
          let val = Utils.escapeHtml(f.value);
          if (f.isEmail) val = `<a href="mailto:${val}" class="meta-link">${val}</a>`;
          if (f.isUrl) val = `<a href="${val}" target="_blank" rel="noopener noreferrer" class="meta-link">${val}</a>`;
          html += `<div class="copyright-info__row"><span class="copyright-info__label">${f.label}</span><span class="copyright-info__value">${val}</span></div>`;
        });
        if (owner.notes) {
          html += `<div class="copyright-info__row"><span class="copyright-info__label">Notes</span><span class="copyright-info__value">${Utils.escapeHtml(owner.notes)}</span></div>`;
        }
        html += '</div>';
      }
      infoContainer.innerHTML = html;
      infoContainer.style.display = visibleFields.length ? 'block' : 'none';
    }

    // Songs
    const songs = data.songs || [];
    const songGrid = document.getElementById('profileSongGrid');
    const emptyEl = document.getElementById('profileEmpty');
    const countEl = document.getElementById('songCount');
    const songsTitleEl = document.getElementById('songsSectionTitle');

    if (songsTitleEl && owner.name) {
      songsTitleEl.textContent = `Songs claimed by ${owner.name}`;
    }
    if (countEl) countEl.textContent = `(${songs.length})`;
    if (songs.length === 0) {
      if (songGrid) songGrid.innerHTML = '';
      if (emptyEl) {
        emptyEl.style.display = 'block';
        const emptyText = emptyEl.querySelector('.empty-state__text');
        if (emptyText) emptyText.textContent = 'No songs claimed by this copyright owner.';
      }
    } else {
      if (emptyEl) emptyEl.style.display = 'none';
      if (songGrid) songGrid.innerHTML = songs.map((s, i) => UI.createSongCard(s, i)).join('');
    }
  },

  updateMeta(data) {
    const owner = data.owner || data;
    const title = `${owner.name} — Copyright Owner — MaraLyrics`;
    const songCount = data.songs?.length || 0;
    const desc = `${owner.name} — Copyright Owner on MaraLyrics. ${songCount} claimed song${songCount !== 1 ? 's' : ''}.`;

    document.title = title;
    const metaDesc = document.getElementById('metaDesc');
    if (metaDesc) metaDesc.content = desc;
    const ogTitle = document.getElementById('ogTitle');
    if (ogTitle) ogTitle.content = title;
    const ogDesc = document.getElementById('ogDesc');
    if (ogDesc) ogDesc.content = desc;
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = title;

    const jsonLd = document.getElementById('jsonLd');
    if (jsonLd) {
      jsonLd.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: owner.name,
        description: `Copyright owner${owner.organization ? ' — ' + owner.organization : ''}`,
        url: window.location.href,
      });
    }
  },

  showError() {
    const skeleton = document.getElementById('profileSkeleton');
    const detail = document.getElementById('profileDetail');
    const error = document.getElementById('profileError');

    if (skeleton) skeleton.style.display = 'none';
    if (detail) detail.style.display = 'none';
    if (error) error.style.display = 'block';
  },
};

// ─── Offline Detection ─────────────────────────────────────────
function initOfflineDetection() {
  window.addEventListener('online', () => {
    UI.setOfflineMode(false);
  });

  window.addEventListener('offline', () => {
    UI.setOfflineMode(true);
  });

  // Initial check
  if (!Utils.isOnline()) {
    UI.setOfflineMode(true);
  }
}

// ─── App Initialization ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize i18n first
  await I18n.init();

  // Initialize theme
  Theme.init();

  // Settings panel toggle
  const settingsBtn = document.querySelector('.settings-toggle__btn');
  const settingsWrap = document.querySelector('.settings-toggle');
  if (settingsBtn && settingsWrap) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsWrap.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!settingsWrap.contains(e.target)) settingsWrap.classList.remove('open');
    });
  }

  initOfflineDetection();

  // Detect which page we're on
  const pageType = Utils.getPageType();

  switch (pageType) {
    case 'song':
      SongPage.init();
      break;
    case 'artist':
      ProfilePage.init('artist');
      break;
    case 'composer':
      ProfilePage.init('composer');
      break;
    case 'copyright-owner':
      CopyrightOwnerPage.init();
      break;
    default:
      HomePage.init();
      break;
  }
});
