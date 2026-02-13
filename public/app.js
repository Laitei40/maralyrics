// ╔══════════════════════════════════════════════════════════════╗
// ║        MaraLyrics — Client-Side Application                 ║
// ║        Vanilla JS · Modular · Offline-Ready                 ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

// ─── Configuration ─────────────────────────────────────────────
const CONFIG = {
  API_BASE: '/api',
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
    const match = path.match(/\/song\/([^/]+)/);
    return match ? match[1] : null;
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
        <p class="song-card__artist">${Utils.escapeHtml(song.artist || 'Unknown Artist')}</p>
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
    html += `<button class="pagination__btn" ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">← Prev</button>`;

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
    html += `<button class="pagination__btn" ${page >= totalPages ? 'disabled' : ''} data-page="${page + 1}">Next →</button>`;

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

      const allBtn = `<button class="category-btn active" data-category="">All</button>`;
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

      this.searchCount.textContent = `(${results.length} found)`;

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
        this.searchCount.textContent = `(${cached.length} cached)`;
        UI.setOfflineMode(true);
      } else {
        const offline = this._offlineSearch(q);
        if (offline.length) {
          this.searchGrid.innerHTML = offline.map((s, i) => UI.createSongCard(s, i)).join('');
          this.searchCount.textContent = `(${offline.length} cached)`;
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
    if (artistEl) artistEl.querySelector('span').textContent = song.artist || 'Unknown';
    if (categoryEl) categoryEl.querySelector('span').textContent = song.category || 'Uncategorized';
    if (viewsEl) viewsEl.querySelector('span').textContent = Utils.formatViews(song.views);
    if (lyricsEl) {
      // Replace literal \n with actual newlines (D1 may store escaped newlines)
      const cleanLyrics = (song.lyrics || '').replace(/\\n/g, '\n');
      lyricsEl.textContent = cleanLyrics;
    }
  },

  /** Update page title, meta tags, and JSON-LD. */
  updateMeta(song) {
    const title = `${song.title} — MaraLyrics`;
    const desc = `Read lyrics of "${song.title}" by ${song.artist || 'Unknown'} on MaraLyrics.`;

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
        composer: song.artist || 'Unknown',
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
document.addEventListener('DOMContentLoaded', () => {
  initOfflineDetection();

  // Detect which page we're on
  const isSongPage = window.location.pathname.startsWith('/song/');

  if (isSongPage) {
    SongPage.init();
  } else {
    HomePage.init();
  }
});
