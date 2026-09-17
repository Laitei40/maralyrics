// ╔══════════════════════════════════════════════════════════════╗
// ║        MaraLyrics — Client-Side Application                 ║
// ║        Vanilla JS · Modular · Offline-Ready                 ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

// ─── Configuration ─────────────────────────────────────────────
const WORKER_ORIGIN = 'https://api.maralyrics.com';
const CONFIG = {
  API_BASE: `${WORKER_ORIGIN}/api/v1`,
  CACHE_PREFIX: 'ml_',
  CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours
  SEARCH_DEBOUNCE: 300,
  ITEMS_PER_PAGE: 20,
  POPULAR_LIMIT: 6,
  VIEW_COOLDOWN: 60 * 60 * 1000, // 1 hour
};

// ─── Utility Module ────────────────────────────────────────────
const Utils = {
  /** Escape all 5 HTML-significant characters — safe in both text content and quoted
   *  attributes (href=, data-*=). A DOM textContent round-trip only escapes &/</>, which
   *  leaves a double quote free to break out of an attribute value. */
  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  /** Format a date string as e.g. "Sep 17, 2026" for article cards/pages. D1's
   *  DATETIME columns come back as 'YYYY-MM-DD HH:MM:SS' (UTC, no timezone marker). */
  formatDateShort(dateStr) {
    if (!dateStr) return '';
    let iso = dateStr;
    if (iso.includes(' ') && !iso.includes('T')) iso = iso.replace(' ', 'T');
    if (!/[Zz]|[+-]\d{2}:\d{2}$/.test(iso)) iso += 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  },

  /** Check if device is online. */
  isOnline() {
    return navigator.onLine;
  },

  /** Today's date as YYYY-MM-DD in the visitor's local timezone (not UTC —
   *  matters for matching all-day calendar events to "today"). */
  todayLocalISODate() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  },

  /** Get slug from current URL path. */
  getSlugFromUrl() {
    const path = window.location.pathname;
    const match = path.match(/\/(song|artist|composer|copyright-owner|article)\/([^/]+)/);
    return match ? match[2] : null;
  },

  /** Get page type from current URL path. */
  getPageType() {
    const path = window.location.pathname;
    if (path.startsWith('/song/')) return 'song';
    if (path.startsWith('/artist/')) return 'artist';
    if (path.startsWith('/composer/')) return 'composer';
    if (path.startsWith('/copyright-owner/')) return 'copyright-owner';
    if (path.startsWith('/article/')) return 'article';
    if (path === '/articles' || path === '/articles.html') return 'articles';
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

  /**
   * Render credited people (artists/composers). A single person renders as a plain link;
   * two or more collapse into a "Various Artists/Composers" trigger that opens a small
   * popover listing each person as its own link (see the delegated click handler below).
   */
  renderCreditedPeople(list, type, variousLabel) {
    if (!list || !list.length) {
      return `<span class="meta-link meta-link--disabled">${this.escapeHtml(I18n.t('common.unknown'))}</span>`;
    }
    if (list.length === 1) {
      return this.renderNameLink(list[0].name, list[0].slug, type);
    }
    const links = list
      .map((item) => `<a href="/${type}/${this.escapeHtml(item.slug)}" class="credits-popover__link">${this.escapeHtml(item.name)}</a>`)
      .join('');
    return `
      <span class="credits-wrap">
        <button type="button" class="meta-link credits-trigger" aria-haspopup="true" aria-expanded="false">${this.escapeHtml(variousLabel)}</button>
        <span class="credits-popover" role="menu">${links}</span>
      </span>
    `;
  },

  /** Plain-text comma-separated names, for titles/meta/search (no markup). */
  joinNames(list, fallback) {
    if (list && list.length) return list.map((item) => item.name).join(', ');
    return fallback || I18n.t('common.unknown');
  },

  /** Prefix a bare domain (e.g. "example.com") with https:// so it resolves as an absolute URL. */
  normalizeUrl(url) {
    if (!url) return url;
    return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  },

  /** Client-side sort matching the /songs API's `sort` values — used for lists (like
   *  favorites) that aren't fetched through that paginated endpoint. */
  sortSongs(songs, sortKey) {
    const comparators = {
      name_asc: (a, b) => (a.title || '').localeCompare(b.title || ''),
      name_desc: (a, b) => (b.title || '').localeCompare(a.title || ''),
      views_asc: (a, b) => (a.views || 0) - (b.views || 0),
      views_desc: (a, b) => (b.views || 0) - (a.views || 0),
      created_asc: (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0),
      created_desc: (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
    };
    return [...songs].sort(comparators[sortKey] || comparators.name_asc);
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
  cacheSongList(page, category, sort, data) {
    const key = `list_${page}_${category || 'all'}_${sort || 'default'}`;
    this.set(key, data);
  },

  /** Get cached song list. */
  getCachedSongList(page, category, sort) {
    const key = `list_${page}_${category || 'all'}_${sort || 'default'}`;
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

// ─── Favorites Module (cookie-backed) ───────────────────────────
const Favorites = {
  COOKIE_NAME: 'favorites',
  MAX_AGE_HOURS: 24 * 365 * 5, // 5 years — a deliberately "saved" list, not a transient cache

  /** Check if preference storage is allowed (same consent gate as SearchHistory). */
  _canStore() {
    return typeof CookieConsent === 'undefined' || CookieConsent.hasConsent();
  },

  /** Get the list of favorited song slugs. */
  getAll() {
    try {
      const raw = Cache.getCookie(this.COOKIE_NAME);
      const slugs = raw ? JSON.parse(raw) : [];
      return Array.isArray(slugs) ? slugs : [];
    } catch {
      return [];
    }
  },

  has(slug) {
    return this.getAll().includes(slug);
  },

  _save(slugs) {
    try {
      Cache.setCookie(this.COOKIE_NAME, JSON.stringify(slugs), this.MAX_AGE_HOURS);
    } catch { /* ignore */ }
  },

  /** Toggle a song's favorite status. Returns the new state (true = now favorited),
   *  or null if storage isn't allowed under the current cookie-consent choice. */
  toggle(slug) {
    if (!this._canStore()) return null;
    const slugs = this.getAll();
    const idx = slugs.indexOf(slug);
    const nowFavorited = idx === -1;
    if (nowFavorited) slugs.push(slug);
    else slugs.splice(idx, 1);
    this._save(slugs);
    return nowFavorited;
  },

  clear() {
    this._save([]);
  },
};

// ─── Display Mode Module (Card / List, shared across all song grids) ───
const DisplayMode = {
  STORAGE_KEY: 'ml_display_mode',
  current: 'card',

  init() {
    try {
      this.current = localStorage.getItem(this.STORAGE_KEY) === 'list' ? 'list' : 'card';
    } catch {
      this.current = 'card';
    }
    this.apply();
    document.querySelectorAll('.view-toggle__btn').forEach((btn) => {
      btn.addEventListener('click', () => this.set(btn.dataset.view));
    });
  },

  /** Reflects `current` onto every song grid + toggle button currently in the DOM. */
  apply() {
    document.querySelectorAll('.song-grid').forEach((grid) => {
      grid.classList.toggle('list', this.current === 'list');
    });
    document.querySelectorAll('.view-toggle__btn').forEach((btn) => {
      const active = btn.dataset.view === this.current;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  },

  set(mode) {
    if (mode !== 'card' && mode !== 'list') return;
    this.current = mode;
    try { localStorage.setItem(this.STORAGE_KEY, mode); } catch { /* ignore */ }
    this.apply();
  },
};

// ─── Search History Module ─────────────────────────────────────
const SearchHistory = {
  MAX_ITEMS: 10,
  STORAGE_KEY: 'ml_search_history',

  /** Check if preference storage is allowed. */
  _canStore() {
    return typeof CookieConsent === 'undefined' || CookieConsent.hasConsent();
  },

  /** Get search history array. */
  getHistory() {
    if (!this._canStore()) return [];
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  },

  /** Add a search term to history. */
  add(term) {
    if (!term?.trim() || !this._canStore()) return;
    const history = this.getHistory();
    const normalized = term.trim();
    const filtered = history.filter(h => h.toLowerCase() !== normalized.toLowerCase());
    filtered.unshift(normalized);
    if (filtered.length > this.MAX_ITEMS) filtered.length = this.MAX_ITEMS;
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filtered)); } catch {}
  },

  /** Remove a specific term. */
  remove(term) {
    const history = this.getHistory();
    const filtered = history.filter(h => h !== term);
    try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filtered)); } catch {}
  },

  /** Clear all history. */
  clear() {
    try { localStorage.removeItem(this.STORAGE_KEY); } catch {}
  },

  /** Create and show the dropdown under the input. */
  show(input) {
    const history = this.getHistory();
    if (history.length === 0) { this.hide(); return; }

    let dropdown = document.getElementById('searchHistory');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = 'searchHistory';
      dropdown.className = 'search-history';
      input.parentElement.appendChild(dropdown);
    }

    const clockSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

    dropdown.innerHTML = `
      <div class="search-history__header">
        <span class="search-history__label">${I18n.t('search_history.recent')}</span>
        <button class="search-history__clear-all">${I18n.t('search_history.clear_all')}</button>
      </div>
      <div class="search-history__list">
        ${history.map(term => `
          <button class="search-history__item" data-term="${Utils.escapeHtml(term)}">
            <span class="search-history__item-icon">${clockSvg}</span>
            <span class="search-history__item-text">${Utils.escapeHtml(term)}</span>
            <span class="search-history__item-remove" title="${I18n.t('search_history.remove')}">✕</span>
          </button>
        `).join('')}
      </div>
    `;

    // Bind events
    dropdown.querySelector('.search-history__clear-all').addEventListener('click', (e) => {
      e.stopPropagation();
      this.clear();
      this.hide();
    });

    dropdown.querySelectorAll('.search-history__item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.search-history__item-remove')) {
          e.stopPropagation();
          this.remove(item.dataset.term);
          this.show(input);
          return;
        }
        input.value = item.dataset.term;
        this.hide();
        // Trigger search
        if (typeof HomePage !== 'undefined') {
          HomePage.handleSearch(item.dataset.term);
        }
      });
    });

    dropdown.classList.add('visible');
  },

  /** Hide the dropdown. */
  hide() {
    const dropdown = document.getElementById('searchHistory');
    if (dropdown) dropdown.classList.remove('visible');
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
  async getSongs(page = 1, category = null, sort = null) {
    let url = `/songs?page=${page}&limit=${CONFIG.ITEMS_PER_PAGE}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    if (sort) url += `&sort=${encodeURIComponent(sort)}`;
    return this.fetchJSON(url);
  },

  /** Get single song by slug. */
  async getSong(slug) {
    return this.fetchJSON(`/songs/${encodeURIComponent(slug)}`);
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
    return this.fetchJSON(`/songs/popular?limit=${CONFIG.POPULAR_LIMIT}`);
  },

  /** Get today's featured song (same for every visitor, changes once a day). */
  async getSongOfTheDay() {
    return this.fetchJSON('/songs/of-the-day');
  },

  /** Increment view count. */
  async incrementView(slug) {
    return fetch(`${CONFIG.API_BASE}/songs/${encodeURIComponent(slug)}/view`, {
      method: 'POST',
    });
  },

  /** Get copyright owner by slug. */
  async getCopyrightOwner(slug) {
    return this.fetchJSON(`/copyright-owners/${encodeURIComponent(slug)}`);
  },

  /** Get artist by slug. */
  async getArtist(slug) {
    return this.fetchJSON(`/artists/${encodeURIComponent(slug)}`);
  },

  /** Get composer by slug. */
  async getComposer(slug) {
    return this.fetchJSON(`/composers/${encodeURIComponent(slug)}`);
  },

  /** Get paginated, published articles. */
  async getArticles(page = 1, sort = null) {
    let url = `/articles?page=${page}&limit=12`;
    if (sort) url += `&sort=${encodeURIComponent(sort)}`;
    return this.fetchJSON(url);
  },

  /** Get single published article by slug. */
  async getArticle(slug) {
    return this.fetchJSON(`/articles/${encodeURIComponent(slug)}`);
  },
};

// ─── UI Rendering Module ───────────────────────────────────────
const UI = {
  /** Create a song card HTML string. */
  createSongCard(song, index = 0) {
    const delay = Math.min(index * 60, 600);
    const isCached = Cache.getCachedSong(song.slug) !== null;
    const isFavorited = Favorites.has(song.slug);
    const slug = Utils.escapeHtml(song.slug);
    // The favorite <button> is a sibling of the <a>, not nested inside it — <a> may not
    // contain interactive content, and nesting would make click targets unpredictable.
    return `
      <div class="song-card stagger-enter" style="animation-delay:${delay}ms" data-slug="${slug}">
        <a href="/song/${slug}" class="song-card__link">
          <h3 class="song-card__title">${Utils.escapeHtml(song.title)}</h3>
          <p class="song-card__artist">${Utils.escapeHtml(Utils.joinNames(song.artists, song.artist_name || song.artist || I18n.t('common.unknown_artist')))}</p>
          <div class="song-card__meta">
            ${song.category ? `<span class="song-card__category">${Utils.escapeHtml(song.category)}</span>` : '<span></span>'}
            <span class="song-card__views">${isCached ? '📌 ' : ''}👁 ${Utils.formatViews(song.views)}</span>
          </div>
        </a>
        <button type="button" class="song-card__favorite${isFavorited ? ' active' : ''}" data-slug="${slug}" aria-pressed="${isFavorited}" aria-label="${I18n.t(isFavorited ? 'common.remove_from_favorites' : 'common.add_to_favorites')}" title="${I18n.t(isFavorited ? 'common.remove_from_favorites' : 'common.add_to_favorites')}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        </button>
      </div>`;
  },

  /** Create the larger featured "Song of the Day" card. Reuses the `.song-card__favorite`
   *  class/markup so the site-wide delegated favorite-toggle handler picks it up for free. */
  createSongOfTheDayCard(song) {
    const isFavorited = Favorites.has(song.slug);
    const slug = Utils.escapeHtml(song.slug);
    const artistDisplay = Utils.joinNames(song.artists, song.artist_name || song.artist || I18n.t('common.unknown_artist'));
    return `
      <div class="song-of-the-day fade-in" data-slug="${slug}">
        <span class="song-of-the-day__badge">${I18n.t('home.song_of_the_day_badge')}</span>
        <a href="/song/${slug}" class="song-of-the-day__link">
          <h3 class="song-of-the-day__title">${Utils.escapeHtml(song.title)}</h3>
          <p class="song-of-the-day__artist">${Utils.escapeHtml(artistDisplay)}</p>
          <div class="song-of-the-day__meta">
            ${song.category ? `<span class="song-card__category">${Utils.escapeHtml(song.category)}</span>` : '<span></span>'}
            <span class="song-card__views">👁 ${Utils.formatViews(song.views)}</span>
          </div>
        </a>
        <button type="button" class="song-card__favorite${isFavorited ? ' active' : ''}" data-slug="${slug}" aria-pressed="${isFavorited}" aria-label="${I18n.t(isFavorited ? 'common.remove_from_favorites' : 'common.add_to_favorites')}" title="${I18n.t(isFavorited ? 'common.remove_from_favorites' : 'common.add_to_favorites')}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        </button>
      </div>`;
  },

  /** Create the "Today's Event" card that takes over the Song of the Day
   *  spot when a marareih.org community event falls on today. Reuses the
   *  same glowing-border card shell for a consistent, modern look. */
  createEventOfTheDayCard(ev) {
    const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(ev.start);
    let when;
    if (isAllDay) {
      when = ev.start === ev.end
        ? new Date(ev.start + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
        : `${new Date(ev.start + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(ev.end + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else {
      when = new Date(ev.start).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    return `
      <div class="song-of-the-day song-of-the-day--event fade-in">
        <span class="song-of-the-day__badge song-of-the-day__badge--event">${I18n.t('home.event_of_the_day_badge')}</span>
        <div class="song-of-the-day__event-body">
          <h3 class="song-of-the-day__title">${Utils.escapeHtml(ev.title)}</h3>
          <p class="song-of-the-day__artist">🗓️ ${Utils.escapeHtml(when)}${ev.location ? ` · 📍 ${Utils.escapeHtml(ev.location)}` : ''}</p>
          ${ev.description ? `<p class="song-of-the-day__event-desc">${Utils.escapeHtml(ev.description)}</p>` : ''}
        </div>
        <button type="button" class="song-of-the-day__event-link" data-calendar-open>${I18n.t('home.event_of_the_day_link')}</button>
      </div>`;
  },

  /** Create skeleton loading cards. */
  /** Create an article card for the /articles listing grid. */
  createArticleCard(article, index = 0) {
    const delay = Math.min(index * 60, 600);
    const slug = Utils.escapeHtml(article.slug);
    const dateStr = article.published_at || article.created_at;
    return `
      <a href="/article/${slug}" class="article-card stagger-enter" style="animation-delay:${delay}ms">
        <h3 class="article-card__title">${Utils.escapeHtml(article.title)}</h3>
        <div class="article-card__meta">
          <span class="article-card__author">${Utils.escapeHtml(article.author_name)}</span>
          <span class="article-card__dot"></span>
          <span class="article-card__date">${Utils.formatDateShort(dateStr)}</span>
        </div>
        ${article.summary ? `<p class="article-card__summary">${Utils.escapeHtml(article.summary)}</p>` : ''}
      </a>`;
  },

  /** Create skeleton cards shaped like an article card. */
  createArticleSkeletons(count = 6) {
    return Array(count)
      .fill('')
      .map(
        () => `
      <div class="skeleton">
        <div class="skeleton__line skeleton__line--title"></div>
        <div class="skeleton__line skeleton__line--short"></div>
        <div class="skeleton__line" style="margin-top:var(--space-md)"></div>
        <div class="skeleton__line skeleton__line--medium"></div>
      </div>`
      )
      .join('');
  },

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

  /** Show/hide the offline badge (header). */
  setOfflineMode(offline) {
    if (typeof Toast !== 'undefined') {
      Toast.setBadge(offline);
    }
  },

  /** Show empty state. `variant` swaps in different copy (e.g. for an empty favorites list)
   *  without needing a second empty-state element in the markup. */
  showEmptyState(show = true, variant = 'default') {
    const el = document.getElementById('emptyState');
    if (!el) return;
    el.style.display = show ? 'block' : 'none';
    if (!show) return;

    const titleEl = el.querySelector('.empty-state__title');
    const textEl = el.querySelector('.empty-state__text');
    const copy = variant === 'favorites'
      ? { title: I18n.t('home.no_favorites_title'), text: I18n.t('home.no_favorites_text') }
      : { title: I18n.t('home.no_songs_title'), text: I18n.t('home.no_songs_text') };
    if (titleEl) titleEl.textContent = copy.title;
    if (textEl) textEl.textContent = copy.text;
  },
};

// ─── Home Page Controller ──────────────────────────────────────
const HomePage = {
  currentPage: 1,
  currentCategory: null,
  currentSort: 'name_asc',
  favoritesOnly: false,

  async init() {
    this.bindElements();
    this.bindEvents();
    // Restore previous page/category/sort so refresh keeps the user's position
    try {
      const saved = sessionStorage.getItem('ml_home_state');
      if (saved) {
        const s = JSON.parse(saved);
        this.currentPage = s.page || 1;
        this.currentCategory = s.category || null;
        this.favoritesOnly = !!s.favoritesOnly;
      }
      this.currentSort = localStorage.getItem('ml_sort') || 'name_asc';
    } catch {}
    if (this.sortSelect) this.sortSelect.value = this.currentSort;
    this.updateFavoritesFilterButton();

    // Load categories first so active button can be highlighted
    await this.loadCategories();
    if (this.currentCategory) this.updateCategoryButtons();
    await Promise.all([
      this.loadFeaturedSpot(),
      this.loadPopular(),
      this.favoritesOnly ? this.loadFavorites() : this.loadSongs(),
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
    this.songOfTheDaySection = document.getElementById('songOfTheDaySection');
    this.songOfTheDayCard = document.getElementById('songOfTheDayCard');
    this.songOfTheDaySectionIcon = document.getElementById('songOfTheDaySectionIcon');
    this.songOfTheDaySectionLabel = document.getElementById('songOfTheDaySectionLabel');
    this.popularSection = document.getElementById('popularSection');
    this.allSongsSection = document.getElementById('allSongsSection');
    this.paginationEl = document.getElementById('pagination');
    this.sortSelect = document.getElementById('sortSelect');
    this.favoritesFilterBtn = document.getElementById('favoritesFilterBtn');
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
        if (!e.target.value.trim()) {
          SearchHistory.show(this.searchInput);
        } else {
          SearchHistory.hide();
        }
        debouncedSearch(e);
      });

      // Show search history on focus when input is empty
      this.searchInput.addEventListener('focus', () => {
        if (!this.searchInput.value.trim()) {
          SearchHistory.show(this.searchInput);
        }
      });

      // Hide search history on click outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.search') && !e.target.closest('.search-history')) {
          SearchHistory.hide();
        }
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
        this.favoritesOnly = false;
        this.updateCategoryButtons();
        this.updateFavoritesFilterButton();
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

    // Sort
    if (this.sortSelect) {
      this.sortSelect.addEventListener('change', () => {
        this.currentSort = this.sortSelect.value;
        try { localStorage.setItem('ml_sort', this.currentSort); } catch {}
        this.currentPage = 1;
        this.favoritesOnly ? this.loadFavorites() : this.loadSongs();
      });
    }

    // Favorites filter — shows only favorited songs in place of the paginated list
    if (this.favoritesFilterBtn) {
      this.favoritesFilterBtn.addEventListener('click', () => {
        this.favoritesOnly = !this.favoritesOnly;
        this.currentPage = 1;
        this.updateFavoritesFilterButton();
        if (this.favoritesOnly) {
          this.currentCategory = null;
          this.updateCategoryButtons();
          this.loadFavorites();
        } else {
          this.loadSongs();
        }
      });
    }
  },

  updateFavoritesFilterButton() {
    if (!this.favoritesFilterBtn) return;
    this.favoritesFilterBtn.classList.toggle('active', this.favoritesOnly);
    this.favoritesFilterBtn.setAttribute('aria-pressed', String(this.favoritesOnly));
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

  // ─── Featured spot: today's community event, falling back to Song of the Day ────
  // Shares the Song of the Day slot rather than adding a second section — the two
  // never have anything useful to say at the same time.
  async loadFeaturedSpot() {
    if (!this.songOfTheDaySection || !this.songOfTheDayCard) return;

    const event = await this.getTodaysEvent();
    if (event) {
      this.songOfTheDaySectionIcon.textContent = '📅';
      this.songOfTheDaySectionLabel.setAttribute('data-i18n', 'home.event_of_the_day');
      I18n.applyToDOM();
      this.songOfTheDayCard.innerHTML = UI.createEventOfTheDayCard(event);
      this.songOfTheDaySection.style.display = 'block';
      return;
    }

    this.songOfTheDaySectionIcon.textContent = '🌟';
    this.songOfTheDaySectionLabel.setAttribute('data-i18n', 'home.song_of_the_day');
    I18n.applyToDOM();
    await this.loadSongOfTheDay();
  },

  /** Looks for a community event on today, via marareih.org's public calendar
   *  API — restricted to the visitor's default calendar (Settings) when one
   *  is set, otherwise any calendar. Cached per-day like Song of the Day. */
  async getTodaysEvent() {
    const todayStr = Utils.todayLocalISODate();
    const defaultCal = CalendarPrefs.get();
    const cacheKey = 'today_event_' + todayStr + (defaultCal ? '_' + defaultCal : '');

    if (!Utils.isOnline()) {
      return Cache.get(cacheKey);
    }

    try {
      const year = new Date().getFullYear();
      const url = new URL('https://calendar-api.marareih.org/api/events');
      url.searchParams.set('year', year);
      if (defaultCal) url.searchParams.set('calendar', defaultCal);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const match = (data.events || []).find((ev) => this.isEventOnDate(ev, todayStr)) || null;
      Cache.set(cacheKey, match);
      return match;
    } catch (err) {
      console.warn('Failed to check for a community event today:', err);
      const cached = Cache.get(cacheKey);
      if (cached) UI.setOfflineMode(true);
      return cached;
    }
  },

  isEventOnDate(ev, dateStr) {
    const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(ev.start);
    // ISO YYYY-MM-DD strings compare lexicographically just like dates.
    return isAllDay ? ev.start <= dateStr && dateStr <= ev.end : ev.start.slice(0, 10) === dateStr;
  },

  // ─── Load Song of the Day ─────────────────────────────
  async loadSongOfTheDay() {
    if (!this.songOfTheDaySection || !this.songOfTheDayCard) return;
    const cacheKey = 'song_of_the_day_' + new Date().toISOString().slice(0, 10);

    try {
      let song;
      if (Utils.isOnline()) {
        song = await API.getSongOfTheDay();
        Cache.set(cacheKey, song);
      } else {
        song = Cache.get(cacheKey);
        if (!song) {
          this.songOfTheDaySection.style.display = 'none';
          return;
        }
        UI.setOfflineMode(true);
      }

      this.songOfTheDayCard.innerHTML = UI.createSongOfTheDayCard(song);
      this.songOfTheDaySection.style.display = 'block';
    } catch (err) {
      console.warn('Failed to load song of the day:', err);
      const cached = Cache.get(cacheKey);
      if (cached) {
        this.songOfTheDayCard.innerHTML = UI.createSongOfTheDayCard(cached);
        this.songOfTheDaySection.style.display = 'block';
        UI.setOfflineMode(true);
      } else {
        this.songOfTheDaySection.style.display = 'none';
      }
    }
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
    // Save current state so refresh restores page + category + favorites-filter
    try {
      sessionStorage.setItem('ml_home_state', JSON.stringify({
        page: this.currentPage,
        category: this.currentCategory || '',
        favoritesOnly: this.favoritesOnly,
      }));
    } catch {}
    this.songGrid.innerHTML = UI.createSkeletons(6);
    this.paginationEl.innerHTML = '';

    try {
      let data;
      if (Utils.isOnline()) {
        data = await API.getSongs(this.currentPage, this.currentCategory, this.currentSort);
        Cache.cacheSongList(this.currentPage, this.currentCategory, this.currentSort, data);
      } else {
        data = Cache.getCachedSongList(this.currentPage, this.currentCategory, this.currentSort);
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
      const cached = Cache.getCachedSongList(this.currentPage, this.currentCategory, this.currentSort);
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

  // ─── Load Favorites (client-side, bypasses server pagination) ────────
  async loadFavorites() {
    if (!this.songGrid) return;
    try {
      sessionStorage.setItem('ml_home_state', JSON.stringify({
        page: this.currentPage,
        category: this.currentCategory || '',
        favoritesOnly: this.favoritesOnly,
      }));
    } catch {}

    const slugs = Favorites.getAll();
    this.paginationEl.innerHTML = '';

    if (!slugs.length) {
      this.songGrid.innerHTML = '';
      UI.showEmptyState(true, 'favorites');
      return;
    }

    this.songGrid.innerHTML = UI.createSkeletons(Math.min(slugs.length, 6));

    if (!Utils.isOnline()) {
      const cached = slugs.map((s) => Cache.getCachedSong(s)).filter(Boolean);
      const sorted = Utils.sortSongs(cached, this.currentSort);
      UI.setOfflineMode(true);
      if (!sorted.length) {
        this.songGrid.innerHTML = '';
        UI.showEmptyState(true, 'favorites');
        return;
      }
      UI.showEmptyState(false);
      this.songGrid.innerHTML = sorted.map((s, i) => UI.createSongCard(s, i)).join('');
      return;
    }

    try {
      const songs = (await Promise.all(slugs.map((s) => API.getSong(s).catch(() => null)))).filter(Boolean);
      const sorted = Utils.sortSongs(songs, this.currentSort);

      if (!sorted.length) {
        this.songGrid.innerHTML = '';
        UI.showEmptyState(true, 'favorites');
        return;
      }

      UI.showEmptyState(false);
      this.songGrid.innerHTML = sorted.map((s, i) => UI.createSongCard(s, i)).join('');
    } catch (err) {
      console.warn('Failed to load favorites:', err);
      this.songGrid.innerHTML = '';
      UI.showEmptyState(true, 'favorites');
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
    SearchHistory.hide();

    this.searchGrid.innerHTML = UI.createSkeletons(3);

    try {
      let results, suggestions = [];
      if (Utils.isOnline()) {
        const data = await API.search(q);
        results = data.results;
        suggestions = data.suggestions || [];
        Cache.set('search_' + q.toLowerCase(), results);
      } else {
        // Offline: search from cached data
        results = this._offlineSearch(q);
        UI.setOfflineMode(true);
      }

      // Search history is saved when a result card is clicked (see below)

      this.searchCount.textContent = I18n.t('common.found', { count: results.length });
      const sugBox = document.getElementById('searchSuggestions');

      if (results.length === 0) {
        this.searchGrid.innerHTML = '';
        if (suggestions.length > 0 && sugBox) {
          sugBox.innerHTML =
            `<p class="suggestions-title">${I18n.t('search.did_you_mean')}</p>` +
            suggestions.map(s => `
              <a href="/song/${Utils.escapeHtml(s.slug)}" class="suggestion-chip">
                <span class="suggestion-chip__title">${Utils.escapeHtml(s.title)}</span>
                ${Number.isFinite(s.match_percent) ? `<span class="suggestion-chip__percent">${s.match_percent}% ${I18n.t('search.match_label')}</span>` : ''}
              </a>
            `).join('');
          sugBox.style.display = 'block';
        } else if (sugBox) {
          sugBox.style.display = 'none';
        }
        UI.showEmptyState(true);
        return;
      }

      if (sugBox) sugBox.style.display = 'none';
      this.searchGrid.innerHTML = results
        .map((s, i) => UI.createSongCard(s, i))
        .join('');

      // Save search term to history when a result card's link is clicked (not the
      // favorite button — favoriting from search results shouldn't count as a visit)
      if (this.searchGrid) {
        this.searchGrid.querySelectorAll('.song-card__link').forEach(link => {
          link.addEventListener('click', () => {
            SearchHistory.add(q);
          });
        });
      }
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
          song.artist?.toLowerCase().includes(q) ||
          song.artists?.some((a) => a.name?.toLowerCase().includes(q))
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
    const sugBox = document.getElementById('searchSuggestions');
    if (sugBox) sugBox.style.display = 'none';
    SearchHistory.hide();
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
    if (artistEl) {
      artistEl.innerHTML = song.artists?.length
        ? Utils.renderCreditedPeople(song.artists, 'artist', I18n.t('song.various_artists'))
        : Utils.renderNameLink(song.artist_name || song.artist, song.artist_slug, 'artist');
    }
    const composerEl = document.getElementById('songComposer');
    if (composerEl) {
      composerEl.innerHTML = song.composers?.length
        ? Utils.renderCreditedPeople(song.composers, 'composer', I18n.t('song.various_composers'))
        : Utils.renderNameLink(song.composer_name || song.composer, song.composer_slug, 'composer');
    }
    if (categoryEl) categoryEl.textContent = song.category || I18n.t('common.uncategorized');
    if (viewsEl) viewsEl.textContent = Utils.formatViews(song.views);

    // Copyright owner (only show if present — displayed at footer of song card)
    const coWrap = document.getElementById('songCopyrightOwnerWrap');
    const coEl = document.getElementById('songCopyrightOwner');
    if (coWrap && coEl) {
      if (song.copyright_owner_name) {
        const link = Utils.renderNameLink(song.copyright_owner_name, song.copyright_owner_slug, 'copyright-owner');
        coEl.innerHTML = `© ${link}`;
        coWrap.style.display = 'block';
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
        artist: Utils.joinNames(song.artists, song.artist_name || song.artist || ''),
      });
      reportBtn.href = '/report?' + params.toString();
    }

    // Favorite toggle — actual click handling is the shared delegated listener; this
    // just gives it the current song's slug and reflects its saved favorite state.
    const favoriteBtn = document.getElementById('btnFavoriteSong');
    if (favoriteBtn && song.slug) {
      favoriteBtn.dataset.slug = song.slug;
      updateFavoriteButton(favoriteBtn, Favorites.has(song.slug));
    }

    this._currentSong = song;
    this.wireSongActions();
  },

  /** Wire up Copy/Share buttons once; handlers read the current song at click-time. */
  wireSongActions() {
    if (this._actionsWired) return;
    this._actionsWired = true;

    const copyBtn = document.getElementById('btnCopyLyrics');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const song = this._currentSong;
        if (!song) return;
        const lyrics = (song.lyrics || '').replace(/\\n/g, '\n');
        try {
          await navigator.clipboard.writeText(lyrics);
          if (typeof Toast !== 'undefined') Toast.show(I18n.t('song.copy_success'), { type: 'success' });
        } catch {
          if (typeof Toast !== 'undefined') Toast.show(I18n.t('song.copy_error'), { type: 'error' });
        }
      });
    }

    const shareBtn = document.getElementById('btnShareSong');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const song = this._currentSong;
        if (!song) return;
        const shareData = {
          title: `${song.title} — MaraLyrics`,
          text: `${song.title} — ${Utils.joinNames(song.artists, song.artist_name || song.artist || I18n.t('common.unknown_artist'))} — MaraLyrics`,
          url: window.location.href,
        };
        try {
          if (navigator.share) {
            await navigator.share(shareData);
          } else {
            await navigator.clipboard.writeText(shareData.url);
            if (typeof Toast !== 'undefined') Toast.show(I18n.t('song.share_success'), { type: 'success' });
          }
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          if (typeof Toast !== 'undefined') Toast.show(I18n.t('song.share_error'), { type: 'error' });
        }
      });
    }
  },

  /** Update page title, meta tags, and JSON-LD. */
  updateMeta(song) {
    const artistDisplay = Utils.joinNames(song.artists, song.artist_name || song.artist || I18n.t('common.unknown'));
    const title = `${song.title} Lyrics – Mara Song | MaraLyrics`;
    const desc = `Read the full lyrics of ${song.title}, a Mara song by ${artistDisplay}. Discover Mara music on MaraLyrics.`;
    const url = `https://maralyrics.com/song/${song.slug}`;

    document.title = title;

    const metaDesc = document.getElementById('metaDesc');
    if (metaDesc) metaDesc.content = desc;

    const ogTitle = document.getElementById('ogTitle');
    if (ogTitle) ogTitle.content = title;

    const ogDesc = document.getElementById('ogDesc');
    if (ogDesc) ogDesc.content = desc;

    const ogUrl = document.getElementById('ogUrl');
    if (ogUrl) ogUrl.content = url;

    const twTitle = document.getElementById('twTitle');
    if (twTitle) twTitle.content = title;

    const twDesc = document.getElementById('twDesc');
    if (twDesc) twDesc.content = desc;

    const canonicalUrl = document.getElementById('canonicalUrl');
    if (canonicalUrl) canonicalUrl.href = url;

    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = title;

    // JSON-LD structured data
    const jsonLd = document.getElementById('jsonLd');
    if (jsonLd) {
      jsonLd.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'MusicRecording',
        name: song.title,
        byArtist: {
          '@type': 'MusicGroup',
          name: artistDisplay,
        },
        inLanguage: 'mrh',
        url,
        publisher: {
          '@type': 'Organization',
          name: 'MaraLyrics',
        },
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
      songsTitleEl.textContent = I18n.t('common.songs_by_name', { name: data.name });
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
    const typeLabel = I18n.t(`${this.type}.role`);
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

    const ogUrl = document.getElementById('ogUrl');
    if (ogUrl) ogUrl.content = window.location.href;

    const twTitle = document.getElementById('twTitle');
    if (twTitle) twTitle.content = title;

    const twDesc = document.getElementById('twDesc');
    if (twDesc) twDesc.content = desc;

    const canonicalUrl = document.getElementById('canonicalUrl');
    if (canonicalUrl) canonicalUrl.href = window.location.href;

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
    if (roleEl) roleEl.textContent = I18n.t('copyright_owner.role');

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
        { label: I18n.t('copyright_owner.full_legal_name'), value: owner.full_legal_name },
        { label: I18n.t('copyright_owner.organization'), value: owner.organization },
        { label: I18n.t('copyright_owner.territory'), value: owner.territory },
        { label: I18n.t('copyright_owner.email'), value: owner.email, isEmail: true },
        { label: I18n.t('common.website'), value: owner.website, isUrl: true },
        { label: I18n.t('copyright_owner.address'), value: owner.address },
        { label: I18n.t('copyright_owner.ipi_number'), value: owner.ipi_number },
        { label: I18n.t('copyright_owner.isrc_prefix'), value: owner.isrc_prefix },
        { label: I18n.t('copyright_owner.pro_affiliation'), value: owner.pro_affiliation },
      ];

      const visibleFields = fields.filter(f => f.value);
      if (visibleFields.length) {
        html += '<div class="copyright-info">';
        visibleFields.forEach(f => {
          let val = Utils.escapeHtml(f.value);
          if (f.isEmail) val = `<a href="mailto:${val}" class="meta-link">${val}</a>`;
          if (f.isUrl) val = `<a href="${Utils.escapeHtml(Utils.normalizeUrl(f.value))}" target="_blank" rel="noopener noreferrer" class="meta-link">${val}</a>`;
          html += `<div class="copyright-info__row"><span class="copyright-info__label">${f.label}</span><span class="copyright-info__value">${val}</span></div>`;
        });
        if (owner.notes) {
          html += `<div class="copyright-info__row"><span class="copyright-info__label">${I18n.t('copyright_owner.notes')}</span><span class="copyright-info__value">${Utils.escapeHtml(owner.notes)}</span></div>`;
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
      songsTitleEl.textContent = I18n.t('copyright_owner.songs_claimed_by', { name: owner.name });
    }
    if (countEl) countEl.textContent = `(${songs.length})`;
    if (songs.length === 0) {
      if (songGrid) songGrid.innerHTML = '';
      if (emptyEl) {
        emptyEl.style.display = 'block';
        const emptyText = emptyEl.querySelector('.empty-state__text');
        if (emptyText) emptyText.textContent = I18n.t('copyright_owner.no_songs');
      }
    } else {
      if (emptyEl) emptyEl.style.display = 'none';
      if (songGrid) songGrid.innerHTML = songs.map((s, i) => UI.createSongCard(s, i)).join('');
    }
  },

  updateMeta(data) {
    const owner = data.owner || data;
    const coRole = I18n.t('copyright_owner.role');
    const title = `${owner.name} — ${coRole} — MaraLyrics`;
    const songCount = data.songs?.length || 0;
    const desc = `${owner.name} — ${coRole} on MaraLyrics. ${songCount} claimed song${songCount !== 1 ? 's' : ''}.`;

    document.title = title;
    const metaDesc = document.getElementById('metaDesc');
    if (metaDesc) metaDesc.content = desc;
    const ogTitle = document.getElementById('ogTitle');
    if (ogTitle) ogTitle.content = title;
    const ogDesc = document.getElementById('ogDesc');
    if (ogDesc) ogDesc.content = desc;
    const ogUrl = document.getElementById('ogUrl');
    if (ogUrl) ogUrl.content = window.location.href;
    const twTitle = document.getElementById('twTitle');
    if (twTitle) twTitle.content = title;
    const twDesc = document.getElementById('twDesc');
    if (twDesc) twDesc.content = desc;
    const canonicalUrl = document.getElementById('canonicalUrl');
    if (canonicalUrl) canonicalUrl.href = window.location.href;
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = title;

    const jsonLd = document.getElementById('jsonLd');
    if (jsonLd) {
      jsonLd.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: owner.name,
        description: `${I18n.t('copyright_owner.role')}${owner.organization ? ' — ' + owner.organization : ''}`,
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

// ─── Articles List Page Controller (/articles) ─────────────────
const ArticlesPage = {
  currentPage: 1,

  async init() {
    await this.loadArticles(1);
  },

  async loadArticles(page) {
    const loading = document.getElementById('articlesLoading');
    const listSection = document.getElementById('articlesListSection');
    const empty = document.getElementById('articlesEmpty');
    const skeletonGrid = document.getElementById('articleSkeletonGrid');
    const grid = document.getElementById('articleGrid');
    if (!loading || !listSection || !grid) return;

    if (skeletonGrid) skeletonGrid.innerHTML = UI.createArticleSkeletons(6);

    try {
      const data = await API.getArticles(page);
      this.currentPage = data.page || 1;
      const articles = data.articles || [];

      loading.style.display = 'none';

      if (!articles.length) {
        listSection.style.display = 'none';
        if (empty) empty.style.display = 'block';
        return;
      }

      if (empty) empty.style.display = 'none';
      listSection.style.display = 'block';
      grid.innerHTML = articles.map((a, i) => UI.createArticleCard(a, i)).join('');
      this.renderPagination(data.page, data.totalPages);
    } catch (err) {
      console.warn('Failed to load articles:', err);
      loading.style.display = 'none';
      listSection.style.display = 'none';
      if (empty) {
        empty.style.display = 'block';
        const title = empty.querySelector('.empty-state__title');
        const text = empty.querySelector('.empty-state__text');
        if (title) title.textContent = I18n.t('articles.error_title');
        if (text) text.textContent = I18n.t('articles.error_text');
      }
    }
  },

  renderPagination(page, totalPages) {
    const el = document.getElementById('articlesPagination');
    if (!el) return;
    if (!totalPages || totalPages <= 1) { el.innerHTML = ''; return; }

    el.innerHTML = UI.createPagination(page, totalPages);
    el.querySelectorAll('[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = Number(btn.dataset.page);
        if (target) {
          this.loadArticles(target);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  },
};

// ─── Article Detail Page Controller (/article/:slug) ───────────
const ArticlePage = {
  async init() {
    const slug = Utils.getSlugFromUrl();
    if (!slug) {
      this.showError();
      return;
    }
    await this.loadArticle(slug);
  },

  async loadArticle(slug) {
    try {
      const article = await API.getArticle(slug);
      this.renderArticle(article);
      this.updateMeta(article);
    } catch (err) {
      console.warn('Failed to load article:', err);
      this.showError();
    }
  },

  renderArticle(article) {
    const skeleton = document.getElementById('articleSkeleton');
    const detail = document.getElementById('articleDetail');
    const error = document.getElementById('articleError');

    if (skeleton) skeleton.style.display = 'none';
    if (error) error.style.display = 'none';
    if (detail) detail.style.display = 'block';

    const titleEl = document.getElementById('articleTitle');
    const authorEl = document.getElementById('articleAuthor');
    const dateEl = document.getElementById('articleDate');
    const summaryEl = document.getElementById('articleSummary');
    const contentEl = document.getElementById('articleContent');
    const breadcrumbTitle = document.getElementById('breadcrumbTitle');

    if (titleEl) titleEl.textContent = article.title;
    if (authorEl) authorEl.textContent = article.author_name;
    if (dateEl) dateEl.textContent = Utils.formatDateShort(article.published_at || article.created_at);
    if (breadcrumbTitle) breadcrumbTitle.textContent = article.title;

    if (summaryEl) {
      if (article.summary) {
        summaryEl.textContent = article.summary;
        summaryEl.style.display = 'block';
      } else {
        summaryEl.style.display = 'none';
      }
    }

    if (contentEl) {
      // Content is stored as plain text with blank-line-separated paragraphs.
      const paragraphs = (article.content || '').replace(/\\n/g, '\n').split(/\n{2,}/).filter(Boolean);
      contentEl.innerHTML = paragraphs.map((p) => `<p>${Utils.escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
    }

    this._currentArticle = article;
    this.wireActions();
  },

  wireActions() {
    if (this._actionsWired) return;
    this._actionsWired = true;

    const shareBtn = document.getElementById('btnShareArticle');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const article = this._currentArticle;
        if (!article) return;
        const shareData = {
          title: `${article.title} — MaraLyrics`,
          text: `${article.title} by ${article.author_name} — MaraLyrics`,
          url: window.location.href,
        };
        try {
          if (navigator.share) {
            await navigator.share(shareData);
          } else {
            await navigator.clipboard.writeText(shareData.url);
            if (typeof Toast !== 'undefined') Toast.show(I18n.t('song.share_success'), { type: 'success' });
          }
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          if (typeof Toast !== 'undefined') Toast.show(I18n.t('song.share_error'), { type: 'error' });
        }
      });
    }
  },

  updateMeta(article) {
    const title = `${article.title} | MaraLyrics`;
    const desc = (article.summary || article.content || '').slice(0, 200);
    const url = `https://maralyrics.com/article/${article.slug}`;

    document.title = title;
    const set = (id, prop, value) => {
      const el = document.getElementById(id);
      if (el) el[prop] = value;
    };
    set('metaDesc', 'content', desc);
    set('ogTitle', 'content', title);
    set('ogDesc', 'content', desc);
    set('ogUrl', 'content', url);
    set('twTitle', 'content', title);
    set('twDesc', 'content', desc);
    set('canonicalUrl', 'href', url);
    set('pageTitle', 'textContent', title);

    const jsonLd = document.getElementById('jsonLd');
    if (jsonLd) {
      jsonLd.textContent = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: article.title,
        author: { '@type': 'Person', name: article.author_name },
        datePublished: article.published_at || article.created_at,
        url,
        publisher: { '@type': 'Organization', name: 'MaraLyrics' },
      });
    }
  },

  showError() {
    const skeleton = document.getElementById('articleSkeleton');
    const detail = document.getElementById('articleDetail');
    const error = document.getElementById('articleError');

    if (skeleton) skeleton.style.display = 'none';
    if (detail) detail.style.display = 'none';
    if (error) error.style.display = 'block';
  },
};

// ─── Service Worker Registration ───────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    // Prefetch page shells and API data in background
    if (reg.active) {
      reg.active.postMessage({ type: 'PRECACHE_PAGES' });
      reg.active.postMessage({ type: 'PRECACHE_API', apiBase: CONFIG.API_BASE });
    }
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          newWorker.postMessage({ type: 'PRECACHE_PAGES' });
          newWorker.postMessage({ type: 'PRECACHE_API', apiBase: CONFIG.API_BASE });
          // Notify user of update if not first install
          if (navigator.serviceWorker.controller) {
            Toast.show(I18n.t('toast.content_updated'), { type: 'success', duration: 2500 });
          }
        }
      });
    });
  }).catch(() => {});
}

// ─── Offline Detection ─────────────────────────────────────────

function initOfflineDetection() {
  // Delegate to centralized Toast module
  if (typeof Toast !== 'undefined') {
    Toast.initOffline();
  }
}

// ─── Credited People Popover (Various Artists / Various Composers) ─────
function closeCreditsPopovers(except) {
  document.querySelectorAll('.credits-wrap.open').forEach((wrap) => {
    if (wrap === except) return;
    wrap.classList.remove('open');
    wrap.querySelector('.credits-trigger')?.setAttribute('aria-expanded', 'false');
  });
}
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('.credits-trigger');
  if (trigger) {
    e.preventDefault();
    const wrap = trigger.closest('.credits-wrap');
    const willOpen = !wrap.classList.contains('open');
    closeCreditsPopovers();
    if (willOpen) {
      wrap.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }
    return;
  }
  if (!e.target.closest('.credits-popover')) closeCreditsPopovers();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCreditsPopovers();
});

// ─── Favorite Toggle (delegated — covers every song-grid, plus the song detail page) ────
function updateFavoriteButton(btn, isFavorited) {
  btn.classList.toggle('active', isFavorited);
  btn.setAttribute('aria-pressed', String(isFavorited));
  const label = I18n.t(isFavorited ? 'common.remove_from_favorites' : 'common.add_to_favorites');
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function initAppPromotion() {
  const footer = document.querySelector('.footer');
  const footerBottom = footer?.querySelector('.footer__bottom');
  if (!footer || !footerBottom || footer.querySelector('.app-promotion')) return;

  const promotion = document.createElement('section');
  promotion.className = 'app-promotion';
  promotion.setAttribute('aria-labelledby', 'appPromotionTitle');
  promotion.innerHTML = `
    <div class="app-promotion__copy">
      <span class="app-promotion__icon" aria-hidden="true">
        <img src="/google-play.ico" alt="" />
      </span>
      <div>
        <h2 id="appPromotionTitle" class="app-promotion__title" data-i18n="footer.app_title">MaraLyrics on Android</h2>
        <p class="app-promotion__text" data-i18n="footer.app_description">Take Mara song lyrics with you. Get the MaraLyrics app on Google Play.</p>
        <span class="app-promotion__offline" data-i18n="footer.app_offline">100% Offline</span>
      </div>
    </div>
    <a class="app-promotion__link" href="https://play.google.com/store/apps/details?id=com.maralyrics.laitei" target="_blank" rel="noopener noreferrer" data-i18n="footer.app_download" data-i18n-title="footer.app_download_title" title="Download MaraLyrics on Google Play">Download app</a>
  `;
  footerBottom.before(promotion);
}

function initAppPromotionDialog() {
  const seenKey = 'ml_app_promo_seen';
  try {
    if (localStorage.getItem(seenKey) === '1') return;
    localStorage.setItem(seenKey, '1');
  } catch (_) {}

  const dialog = document.createElement('div');
  dialog.className = 'app-promo-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'appPromoDialogTitle');
  dialog.setAttribute('aria-describedby', 'appPromoDialogDescription');
  dialog.innerHTML = `
    <div class="app-promo-dialog__backdrop" data-app-promo-close></div>
    <section class="app-promo-dialog__panel">
      <div class="app-promo-dialog__controls">
        <div class="app-promo-dialog__language">
          <button type="button" class="app-promo-dialog__language-btn" aria-label="Choose language" data-i18n-aria="app_promo.language_aria" aria-expanded="false" aria-controls="appPromoLanguageMenu">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </button>
          <div class="app-promo-dialog__language-menu" id="appPromoLanguageMenu" role="menu" aria-label="Languages" data-i18n-aria="app_promo.language_menu_aria">
            <button type="button" role="menuitem" class="app-promo-dialog__language-option" data-dialog-lang="en">EN</button>
            <button type="button" role="menuitem" class="app-promo-dialog__language-option" data-dialog-lang="mrh">Mara</button>
            <button type="button" role="menuitem" class="app-promo-dialog__language-option" data-dialog-lang="my">မြန်မာ</button>
          </div>
        </div>
        <button type="button" class="app-promo-dialog__close" data-app-promo-close aria-label="Close" data-i18n-aria="app_promo.close_aria">&times;</button>
      </div>
      <div class="app-promo-dialog__art" aria-hidden="true">
        <div class="app-promo-dialog__glow"></div>
        <div class="app-promo-dialog__icon"><img src="/google-play.ico" alt="" /></div>
      </div>
      <div class="app-promo-dialog__content">
        <span class="app-promo-dialog__eyebrow" data-i18n="app_promo.eyebrow">Made for Mara music</span>
        <h2 id="appPromoDialogTitle" class="app-promo-dialog__title" data-i18n="app_promo.title">MaraLyrics, wherever you are</h2>
        <p id="appPromoDialogDescription" class="app-promo-dialog__description" data-i18n="app_promo.description">Keep your favorite Mara song lyrics close with the MaraLyrics Android app.</p>
        <span class="app-promo-dialog__offline" data-i18n="app_promo.offline">100% Offline</span>
        <div class="app-promo-dialog__actions">
          <a class="app-promo-dialog__download" href="https://play.google.com/store/apps/details?id=com.maralyrics.laitei" target="_blank" rel="noopener noreferrer" data-i18n="app_promo.download" data-i18n-title="app_promo.download_title" title="Download MaraLyrics on Google Play">Get the app</a>
          <button type="button" class="app-promo-dialog__later" data-app-promo-close data-i18n="app_promo.later">Maybe later</button>
        </div>
      </div>
    </section>
  `;

  document.body.appendChild(dialog);
  I18n.applyToDOM();

  const close = () => {
    dialog.classList.remove('visible');
    document.body.classList.remove('app-promo-dialog-open');
    document.removeEventListener('keydown', onKeydown);
    setTimeout(() => dialog.remove(), 250);
  };
  const onKeydown = (event) => {
    if (event.key === 'Escape') close();
  };

  dialog.querySelectorAll('[data-app-promo-close]').forEach((element) => {
    element.addEventListener('click', close);
  });
  const languageButton = dialog.querySelector('.app-promo-dialog__language-btn');
  const languageMenu = dialog.querySelector('.app-promo-dialog__language-menu');
  languageButton.addEventListener('click', () => {
    const isOpen = languageMenu.classList.toggle('open');
    languageButton.setAttribute('aria-expanded', String(isOpen));
  });
  dialog.querySelectorAll('[data-dialog-lang]').forEach((option) => {
    option.addEventListener('click', async () => {
      await I18n.setLanguage(option.dataset.dialogLang);
      languageMenu.classList.remove('open');
      languageButton.setAttribute('aria-expanded', 'false');
      dialog.querySelector('.app-promo-dialog__close').focus();
    });
  });
  dialog.querySelector('.app-promo-dialog__download').addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
  document.body.classList.add('app-promo-dialog-open');
  requestAnimationFrame(() => dialog.classList.add('visible'));
  dialog.querySelector('.app-promo-dialog__close').focus();
}

// Mirrors the fixed category set marareih.org's own calendars.html uses, so
// a calendar's icon matches what it shows there — shared by the calendar
// dialog's picker pills and the default-calendar prompt/settings.
const CALENDAR_CATEGORY_ICONS = {
  general: '📅', church: '⛪', education: '🎓', holiday: '🎉',
  youth: '🎈', music: '🎵', community: '🤝', women: '👩', family: '👪',
};

// ─── Calendar preference (default calendar, set in Settings) ───────────────
// Shared by the Settings dropdown, the calendar dialog's initial selection,
// and the homepage's "Today's Event" lookup, so all three agree on which
// calendar the visitor cares about. Also owns the one shared /api/calendars
// fetch per page load, so those three don't each make their own request.
const CalendarPrefs = (() => {
  const STORAGE_KEY = 'ml_default_calendar';
  const PROMPTED_KEY = 'ml_calendar_pref_prompted';
  const API = 'https://calendar-api.marareih.org';
  let calendarsPromise = null;

  function get() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { return ''; }
  }

  function set(slug) {
    try {
      if (slug) localStorage.setItem(STORAGE_KEY, slug);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }

  /** Fetches and caches the calendar list for this page load. Rejects (and
   *  clears the cache so the next call retries) if the request fails. */
  function loadCalendars() {
    if (!calendarsPromise) {
      calendarsPromise = fetch(`${API}/api/calendars`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => (data.calendars || []).slice().sort((a, b) => a.name.localeCompare(b.name)))
        .catch((err) => {
          calendarsPromise = null;
          throw err;
        });
    }
    return calendarsPromise;
  }

  /** Populates the Settings panel's calendar <select>, if present on this
   *  page, and persists the visitor's choice on change. */
  async function initSelect() {
    const select = document.getElementById('calendarPrefSelect');
    if (!select) return;

    try {
      const calendars = await loadCalendars();
      calendars.forEach((cal) => {
        const opt = document.createElement('option');
        opt.value = cal.slug;
        opt.textContent = cal.name;
        select.appendChild(opt);
      });
      const saved = get();
      select.value = calendars.some((cal) => cal.slug === saved) ? saved : '';
    } catch (err) {
      console.warn('[calendar] failed to load calendars for settings:', err);
      select.disabled = true;
      return;
    }

    select.addEventListener('change', () => {
      set(select.value);
      if (typeof Toast !== 'undefined') {
        Toast.show(I18n.t('toast.default_calendar_changed'), { type: 'info', duration: 2000 });
      }
    });
  }

  /** First-visit-only prompt asking which calendar's events should show in
   *  Today's Event. Resolves once dismissed (by a choice, Skip, backdrop, or
   *  Escape) or immediately if there's nothing to ask, so callers can
   *  sequence it ahead of other first-visit dialogs (e.g. the app promo). */
  function promptIfNeeded() {
    return new Promise((resolve) => {
      let alreadyPrompted = true;
      try { alreadyPrompted = localStorage.getItem(PROMPTED_KEY) === '1'; } catch (e) { /* default true: skip on storage errors */ }

      if (alreadyPrompted || get()) {
        resolve();
        return;
      }
      try { localStorage.setItem(PROMPTED_KEY, '1'); } catch (e) { /* ignore */ }

      const dialog = document.createElement('div');
      dialog.className = 'calendar-pref-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'calendarPrefDialogTitle');
      dialog.innerHTML = `
        <div class="calendar-pref-dialog__backdrop" data-calendar-pref-skip></div>
        <section class="calendar-pref-dialog__panel">
          <span class="calendar-pref-dialog__icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </span>
          <h2 id="calendarPrefDialogTitle" class="calendar-pref-dialog__title" data-i18n="calendar_pref_dialog.title">Pick your calendar</h2>
          <p class="calendar-pref-dialog__desc" data-i18n="calendar_pref_dialog.description">Choose which community calendar's events show in Today's Event on the homepage. You can change this anytime in Settings.</p>
          <div class="calendar-pref-dialog__list" id="calendarPrefDialogList">
            <p class="calendar-pref-dialog__loading" data-i18n="calendar.loading">Loading events…</p>
          </div>
          <button type="button" class="calendar-pref-dialog__skip" data-calendar-pref-skip data-i18n="calendar_pref_dialog.skip">Skip for now</button>
        </section>
      `;
      document.body.appendChild(dialog);
      I18n.applyToDOM();
      document.body.classList.add('calendar-pref-dialog-open');
      requestAnimationFrame(() => dialog.classList.add('visible'));

      const close = () => {
        dialog.classList.remove('visible');
        document.body.classList.remove('calendar-pref-dialog-open');
        document.removeEventListener('keydown', onKeydown);
        setTimeout(() => dialog.remove(), 250);
        resolve();
      };
      const onKeydown = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKeydown);
      dialog.querySelectorAll('[data-calendar-pref-skip]').forEach((el) => el.addEventListener('click', close));

      const list = dialog.querySelector('#calendarPrefDialogList');
      loadCalendars().then((calendars) => {
        const allOption = `<button type="button" class="calendar-pref-dialog__option calendar-pref-dialog__option--all" data-calendar-slug="">
          <span class="calendar-pref-dialog__option-name" data-i18n="settings_panel.calendar_all">All calendars</span>
        </button>`;
        const calendarOptions = calendars.map((cal) => {
          const icon = CALENDAR_CATEGORY_ICONS[cal.category] || CALENDAR_CATEGORY_ICONS.general;
          return `<button type="button" class="calendar-pref-dialog__option" data-calendar-slug="${Utils.escapeHtml(cal.slug)}">
            <span class="calendar-pref-dialog__option-icon" aria-hidden="true">${icon}</span>
            <span class="calendar-pref-dialog__option-name">${Utils.escapeHtml(cal.name)}</span>
          </button>`;
        }).join('');
        list.innerHTML = allOption + calendarOptions;
        I18n.applyToDOM();
        list.querySelectorAll('[data-calendar-slug]').forEach((btn) => {
          btn.addEventListener('click', () => {
            set(btn.dataset.calendarSlug);
            const select = document.getElementById('calendarPrefSelect');
            if (select) select.value = btn.dataset.calendarSlug;
            if (typeof Toast !== 'undefined') {
              Toast.show(I18n.t('toast.default_calendar_changed'), { type: 'success', duration: 2200 });
            }
            close();
          });
        });
      }).catch((err) => {
        console.warn('[calendar] failed to load calendars for the first-visit prompt:', err);
        list.innerHTML = `<p class="calendar-pref-dialog__error" data-i18n="calendar.calendars_error">Could not load calendars. Please try again later.</p>`;
        I18n.applyToDOM();
      });
    });
  }

  return { get, set, loadCalendars, initSelect, promptIfNeeded };
})();

// ─── Community Calendar (events pulled live from calendar-api.marareih.org) ────
// Read-only, unauthenticated, CORS-open JSON feed — see marareih.org's
// calendar-worker/API.md. We fetch one year at a time and let the visitor
// step forward/back; nothing here writes to that API.
const CalendarFeature = (() => {
  const API = 'https://calendar-api.marareih.org';
  const MIN_YEAR = 1970;
  const MAX_YEAR = 2200;

  const LOADING_HTML = `
    <div class="calendar-dialog__loading">
      <span class="calendar-dialog__spinner" aria-hidden="true"></span>
      <p data-i18n="calendar.loading">Loading events…</p>
    </div>`;

  function errorHtml(key, fallback) {
    return `
      <div class="calendar-dialog__error">
        <svg class="calendar-dialog__state-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 17h.01"/></svg>
        <p data-i18n="${key}">${fallback}</p>
        <button type="button" class="calendar-dialog__retry" data-calendar-retry data-i18n="calendar.retry">Try again</button>
      </div>`;
  }

  const NO_CALENDARS_HTML = `
    <div class="calendar-dialog__empty">
      <svg class="calendar-dialog__state-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9.5" y1="14.5" x2="14.5" y2="19.5"/><line x1="14.5" y1="14.5" x2="9.5" y2="19.5"/></svg>
      <p data-i18n="calendar.no_calendars">No calendars available yet.</p>
    </div>`;

  const eventsCache = {}; // `${calendarSlug}:${year}` -> events[]
  let calendarsList = null; // null = not loaded yet, [] = loaded but empty
  let calendarsLoadFailed = false;
  let dialog = null;
  let currentYear = new Date().getFullYear();
  let currentCalendarSlug = null;
  let requestSeq = 0;

  function isAllDayDate(str) {
    return /^\d{4}-\d{2}-\d{2}$/.test(str);
  }

  function formatEventWhen(ev) {
    if (isAllDayDate(ev.start)) {
      const startFmt = new Date(ev.start + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      if (ev.start === ev.end) return startFmt;
      const endFmt = new Date(ev.end + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      return `${startFmt} – ${endFmt}`;
    }
    return new Date(ev.start).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function isSingleAllDay(ev) {
    return isAllDayDate(ev.start) && ev.start === ev.end;
  }

  /** A compact "05 / MAR" day badge for the common single-day case; falls
   *  back to the full date range as text for multi-day/timed events. */
  function eventBadgeHtml(ev) {
    if (isSingleAllDay(ev)) {
      const d = new Date(ev.start + 'T00:00:00');
      const day = d.toLocaleDateString(undefined, { day: '2-digit' });
      const month = d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
      return `<span class="calendar-event__badge"><span class="calendar-event__badge-day">${day}</span><span class="calendar-event__badge-month">${Utils.escapeHtml(month)}</span></span>`;
    }
    return `<span class="calendar-event__badge calendar-event__badge--text">${Utils.escapeHtml(formatEventWhen(ev))}</span>`;
  }

  function monthLabel(ev) {
    const d = new Date(isAllDayDate(ev.start) ? ev.start + 'T00:00:00' : ev.start);
    return d.toLocaleDateString(undefined, { month: 'long' });
  }

  function currentCalendarName() {
    const cal = (calendarsList || []).find((c) => c.slug === currentCalendarSlug);
    return cal ? cal.name : '';
  }

  // ── Calendar picker (MEC / ECM / MADC / …, whatever exists in the API) ──
  function renderCalendarPicker() {
    const picker = dialog.querySelector('#calendarDialogPicker');
    if (!calendarsList || !calendarsList.length) {
      picker.innerHTML = '';
      return;
    }
    picker.innerHTML = calendarsList.map((cal) => {
      const icon = CALENDAR_CATEGORY_ICONS[cal.category] || CALENDAR_CATEGORY_ICONS.general;
      return `<button type="button" class="calendar-dialog__picker-pill${cal.slug === currentCalendarSlug ? ' active' : ''}" data-calendar-slug="${Utils.escapeHtml(cal.slug)}" aria-pressed="${cal.slug === currentCalendarSlug}">${icon} ${Utils.escapeHtml(cal.name)}</button>`;
    }).join('');
    picker.querySelectorAll('[data-calendar-slug]').forEach((btn) => {
      btn.addEventListener('click', () => selectCalendar(btn.dataset.calendarSlug));
    });
  }

  function selectCalendar(slug) {
    if (slug === currentCalendarSlug) return;
    currentCalendarSlug = slug;
    renderCalendarPicker();
    renderYear(currentYear);
  }

  async function ensureCalendars() {
    if (calendarsList !== null || calendarsLoadFailed) return;
    try {
      calendarsList = await CalendarPrefs.loadCalendars();
      const defaultSlug = CalendarPrefs.get();
      const hasDefault = calendarsList.some((cal) => cal.slug === defaultSlug);
      currentCalendarSlug = hasDefault ? defaultSlug : (calendarsList.length ? calendarsList[0].slug : null);
    } catch (err) {
      console.warn('[calendar] failed to load calendars:', err);
      calendarsLoadFailed = true;
    }
  }

  // ── Event list + inline expandable details, grouped by month ──
  function renderEvents(events) {
    const body = dialog.querySelector('#calendarDialogBody');
    if (!events.length) {
      body.innerHTML = `
        <div class="calendar-dialog__empty">
          <svg class="calendar-dialog__state-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9.5" y1="14.5" x2="14.5" y2="19.5"/><line x1="14.5" y1="14.5" x2="9.5" y2="19.5"/></svg>
          <p></p>
        </div>`;
      body.querySelector('p').textContent = I18n.t('calendar.empty_for', { calendar: currentCalendarName(), year: currentYear });
      return;
    }

    let lastMonth = null;
    const rows = events.map((ev, i) => {
      const month = monthLabel(ev);
      const monthHeader = month !== lastMonth ? `<li class="calendar-event-month" role="presentation">${Utils.escapeHtml(month)}</li>` : '';
      lastMonth = month;
      const delay = (Math.min(i, 10) * 0.04).toFixed(2);
      return `${monthHeader}<li class="calendar-event" style="animation-delay:${delay}s">
        <button type="button" class="calendar-event__summary" aria-expanded="false" aria-controls="calEventDetails${i}">
          ${eventBadgeHtml(ev)}
          <span class="calendar-event__summary-text">
            <span class="calendar-event__title">${Utils.escapeHtml(ev.title)}</span>
            ${ev.location ? `<span class="calendar-event__meta">📍 ${Utils.escapeHtml(ev.location)}</span>` : ''}
          </span>
          <svg class="calendar-event__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="calendar-event__details" id="calEventDetails${i}" hidden>
          <p>${ev.description ? Utils.escapeHtml(ev.description).replace(/\n/g, '<br>') : Utils.escapeHtml(I18n.t('calendar.no_description'))}</p>
        </div>
      </li>`;
    });

    body.innerHTML = `<ul class="calendar-event-list">${rows.join('')}</ul>`;

    body.querySelectorAll('.calendar-event__summary').forEach((btn) => {
      btn.addEventListener('click', () => {
        const details = btn.nextElementSibling;
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!expanded));
        details.hidden = expanded;
      });
    });
  }

  async function renderYear(year) {
    if (!currentCalendarSlug) return;

    dialog.querySelector('#calendarDialogYear').textContent = String(year);
    dialog.querySelectorAll('[data-year-step]').forEach((btn) => {
      const target = year + Number(btn.dataset.yearStep);
      btn.disabled = target < MIN_YEAR || target > MAX_YEAR;
    });

    const cacheKey = `${currentCalendarSlug}:${year}`;
    if (eventsCache[cacheKey]) {
      renderEvents(eventsCache[cacheKey]);
      return;
    }

    const body = dialog.querySelector('#calendarDialogBody');
    body.innerHTML = LOADING_HTML;
    I18n.applyToDOM();

    const seq = ++requestSeq;
    try {
      const res = await fetch(`${API}/api/events?year=${year}&calendar=${encodeURIComponent(currentCalendarSlug)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (seq !== requestSeq) return; // superseded by a newer year/calendar switch
      eventsCache[cacheKey] = data.events || [];
      renderEvents(eventsCache[cacheKey]);
    } catch (err) {
      if (seq !== requestSeq) return;
      console.warn('[calendar] failed to load events:', err);
      body.innerHTML = errorHtml('calendar.error', 'Could not load events. Please try again later.');
      I18n.applyToDOM();
    }
  }

  /** Retries whichever request last failed — the calendars list or the
   *  current year's events — without losing the visitor's place. */
  function retry() {
    if (calendarsLoadFailed) {
      calendarsLoadFailed = false;
      open();
      return;
    }
    if (currentCalendarSlug) {
      delete eventsCache[`${currentCalendarSlug}:${currentYear}`];
      renderYear(currentYear);
    }
  }

  function stepYear(delta) {
    const next = currentYear + delta;
    if (next < MIN_YEAR || next > MAX_YEAR) return;
    currentYear = next;
    renderYear(currentYear);
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && dialog && dialog.classList.contains('visible')) close();
  }

  function close() {
    if (!dialog) return;
    dialog.classList.remove('visible');
    document.body.classList.remove('calendar-dialog-open');
  }

  function buildDialog() {
    if (dialog) return dialog;

    dialog = document.createElement('div');
    dialog.className = 'calendar-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'calendarDialogTitle');
    dialog.innerHTML = `
      <div class="calendar-dialog__backdrop" data-calendar-close></div>
      <section class="calendar-dialog__panel">
        <header class="calendar-dialog__header">
          <h2 id="calendarDialogTitle" class="calendar-dialog__title">
            <span class="calendar-dialog__title-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </span>
            <span data-i18n="calendar.title">Community Calendar</span>
          </h2>
          <button type="button" class="calendar-dialog__close" data-calendar-close aria-label="Close" data-i18n-aria="calendar.close_aria">&times;</button>
        </header>
        <div class="calendar-dialog__picker" id="calendarDialogPicker" role="group" aria-label="Choose a calendar" data-i18n-aria="calendar.picker_aria"></div>
        <div class="calendar-dialog__year-nav">
          <button type="button" class="calendar-dialog__year-btn" data-year-step="-1" aria-label="Previous year" data-i18n-aria="calendar.prev_year_aria">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="calendar-dialog__year" id="calendarDialogYear"></span>
          <button type="button" class="calendar-dialog__year-btn" data-year-step="1" aria-label="Next year" data-i18n-aria="calendar.next_year_aria">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="calendar-dialog__body" id="calendarDialogBody"></div>
        <footer class="calendar-dialog__footer">
          <a href="https://marareih.org/calendars.html" target="_blank" rel="noopener noreferrer" data-i18n="calendar.subscribe_link">See all calendars &amp; subscribe →</a>
        </footer>
      </section>
    `;
    document.body.appendChild(dialog);
    I18n.applyToDOM();

    dialog.querySelectorAll('[data-calendar-close]').forEach((el) => el.addEventListener('click', close));
    dialog.querySelectorAll('[data-year-step]').forEach((btn) => {
      btn.addEventListener('click', () => stepYear(Number(btn.dataset.yearStep)));
    });
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-calendar-retry]')) retry();
    });
    document.addEventListener('keydown', onKeydown);

    return dialog;
  }

  async function open() {
    buildDialog();
    dialog.classList.add('visible');
    document.body.classList.add('calendar-dialog-open');
    dialog.querySelector('.calendar-dialog__close').focus();

    const body = dialog.querySelector('#calendarDialogBody');
    if (calendarsList === null && !calendarsLoadFailed) {
      body.innerHTML = LOADING_HTML;
      I18n.applyToDOM();
    }

    await ensureCalendars();
    renderCalendarPicker();
    dialog.classList.toggle('calendar-dialog--no-calendar', !currentCalendarSlug);

    if (calendarsLoadFailed) {
      body.innerHTML = errorHtml('calendar.calendars_error', 'Could not load calendars. Please try again later.');
      I18n.applyToDOM();
      return;
    }
    if (!currentCalendarSlug) {
      body.innerHTML = NO_CALENDARS_HTML;
      I18n.applyToDOM();
      return;
    }
    renderYear(currentYear);
  }

  // Delegated so buttons added later (e.g. the Today's Event card, injected
  // after this runs) open the dialog too, without needing their own binding.
  function init() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-calendar-open]')) open();
    });
  }

  return { init };
})();

// ─── In-app Notifications (new songs + today's events, checked while the site is open) ────
// Not push notifications — there's no server-side subscription or send path.
// While a tab is open we poll the same public APIs everything else here
// uses, diff against what's already been seen (localStorage), and surface
// the delta both in the panel and — if permission was granted — as a
// native browser Notification.
const NotificationsFeature = (() => {
  const ITEMS_KEY = 'ml_notif_items';
  const SEEN_SONGS_KEY = 'ml_notif_seen_songs';
  const SEEN_EVENTS_KEY = 'ml_notif_seen_events';
  const SEEN_ARTICLES_KEY = 'ml_notif_seen_articles';
  const MAX_ITEMS = 30;
  const MAX_SEEN = 500;
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;

  let items = [];

  function loadItems() {
    try {
      const raw = localStorage.getItem(ITEMS_KEY);
      items = raw ? JSON.parse(raw) : [];
    } catch (e) {
      items = [];
    }
  }

  function saveItems() {
    items = items.slice(0, MAX_ITEMS);
    try { localStorage.setItem(ITEMS_KEY, JSON.stringify(items)); } catch (e) { /* ignore */ }
  }

  function getSeenSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch (e) { return new Set(); }
  }

  function saveSeenSet(key, set) {
    try { localStorage.setItem(key, JSON.stringify(Array.from(set).slice(-MAX_SEEN))); } catch (e) { /* ignore */ }
  }

  function updateBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    const unread = items.filter((i) => !i.read).length;
    if (unread > 0) {
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function renderList() {
    const list = document.getElementById('notifList');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = `<p class="notif-panel__empty" data-i18n="notifications.empty">Nothing new yet.</p>`;
      I18n.applyToDOM();
      return;
    }
    list.innerHTML = items.map((item) => `
      <a href="${Utils.escapeHtml(item.url || '#')}" class="notif-item${item.read ? '' : ' unread'}" data-notif-id="${Utils.escapeHtml(item.id)}">
        <span class="notif-item__icon" aria-hidden="true">${{ song: '🎵', article: '📰', event: '📅' }[item.type] || '🔔'}</span>
        <span class="notif-item__body">
          <span class="notif-item__title">${Utils.escapeHtml(item.title)}</span>
          ${item.body ? `<span class="notif-item__meta">${Utils.escapeHtml(item.body)}</span>` : ''}
        </span>
      </a>`).join('');
  }

  function fireBrowserNotification(item) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(item.title, { body: item.body || '', icon: '/icon.svg', tag: item.id });
      n.onclick = () => {
        window.focus();
        if (item.url) window.location.href = item.url;
        n.close();
      };
    } catch (e) {
      // Notification constructor can throw in some contexts (e.g. certain mobile browsers) — the in-app panel still has it.
    }
  }

  function addItem(item) {
    items = items.filter((i) => i.id !== item.id);
    items.unshift(item);
    saveItems();
    updateBadge();
    renderList();
    fireBrowserNotification(item);
  }

  async function checkNewSongs() {
    try {
      const data = await API.getSongs(1, null, 'created_desc');
      const songs = data.songs || [];
      const seen = getSeenSet(SEEN_SONGS_KEY);
      const firstRun = seen.size === 0;
      const freshSongs = songs.filter((s) => s.slug && !seen.has(s.slug));
      songs.forEach((s) => { if (s.slug) seen.add(s.slug); });
      saveSeenSet(SEEN_SONGS_KEY, seen);

      // First check ever: this seeds "already known" songs rather than notifying about the whole catalog.
      if (firstRun) return;

      freshSongs.forEach((song) => {
        addItem({
          id: 'song_' + song.slug,
          type: 'song',
          title: I18n.t('notifications.new_song_title'),
          body: song.title + (song.artist_name || song.artist ? ' — ' + (song.artist_name || song.artist) : ''),
          url: '/song/' + song.slug,
          read: false,
          ts: Date.now(),
        });
      });
    } catch (err) {
      console.warn('[notifications] failed to check new songs:', err);
    }
  }

  async function checkNewArticles() {
    try {
      // Sorted by published_at (the default) — that's what "just went live" means for
      // articles, unlike created_desc which wouldn't move when a long-drafted article
      // finally gets published.
      const data = await API.getArticles(1);
      const articles = data.articles || [];
      const seen = getSeenSet(SEEN_ARTICLES_KEY);
      const firstRun = seen.size === 0;
      const freshArticles = articles.filter((a) => a.slug && !seen.has(a.slug));
      articles.forEach((a) => { if (a.slug) seen.add(a.slug); });
      saveSeenSet(SEEN_ARTICLES_KEY, seen);

      // First check ever: seeds "already known" articles rather than notifying about the whole backlog.
      if (firstRun) return;

      freshArticles.forEach((article) => {
        addItem({
          id: 'article_' + article.slug,
          type: 'article',
          title: I18n.t('notifications.new_article_title'),
          body: article.title + ' — ' + article.author_name,
          url: '/article/' + article.slug,
          read: false,
          ts: Date.now(),
        });
      });
    } catch (err) {
      console.warn('[notifications] failed to check new articles:', err);
    }
  }

  async function checkTodaysEvents() {
    try {
      const todayStr = Utils.todayLocalISODate();
      const defaultCal = CalendarPrefs.get();
      const url = new URL('https://calendar-api.marareih.org/api/events');
      url.searchParams.set('year', new Date().getFullYear());
      if (defaultCal) url.searchParams.set('calendar', defaultCal);

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const todaysEvents = (data.events || []).filter((ev) => HomePage.isEventOnDate(ev, todayStr));

      const seen = getSeenSet(SEEN_EVENTS_KEY);
      todaysEvents.forEach((ev) => {
        const seenKey = ev.id + ':' + todayStr;
        if (seen.has(seenKey)) return;
        seen.add(seenKey);
        addItem({
          id: 'event_' + seenKey,
          type: 'event',
          title: I18n.t('notifications.event_today_title'),
          body: ev.title + (ev.location ? ' — ' + ev.location : ''),
          url: '/',
          read: false,
          ts: Date.now(),
        });
      });
      saveSeenSet(SEEN_EVENTS_KEY, seen);
    } catch (err) {
      console.warn('[notifications] failed to check today\'s events:', err);
    }
  }

  function runChecks() {
    checkNewSongs();
    checkNewArticles();
    checkTodaysEvents();
  }

  function updatePermissionBanner() {
    const banner = document.getElementById('notifPermissionBanner');
    if (!banner) return;
    banner.hidden = !(typeof Notification !== 'undefined' && Notification.permission === 'default');
  }

  function markRead(id) {
    const item = items.find((i) => i.id === id);
    if (!item || item.read) return;
    item.read = true;
    saveItems();
    updateBadge();
    const el = document.querySelector(`.notif-item[data-notif-id="${CSS.escape(id)}"]`);
    if (el) el.classList.remove('unread');
  }

  function clearAll() {
    items = [];
    saveItems();
    updateBadge();
    renderList();
  }

  function init() {
    loadItems();
    updateBadge();
    renderList();
    updatePermissionBanner();

    const enableBtn = document.getElementById('notifEnableBtn');
    if (enableBtn) {
      enableBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (typeof Notification === 'undefined') return;
        const permission = await Notification.requestPermission();
        updatePermissionBanner();
        if (permission === 'granted' && typeof Toast !== 'undefined') {
          Toast.show(I18n.t('notifications.enabled_toast'), { type: 'success', duration: 2200 });
        }
      });
    }

    const clearBtn = document.getElementById('notifClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearAll();
      });
    }

    document.addEventListener('click', (e) => {
      const item = e.target.closest('.notif-item');
      if (item) markRead(item.dataset.notifId);
    });

    runChecks();
    setInterval(runChecks, CHECK_INTERVAL_MS);
  }

  return { init };
})();

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.song-card__favorite, .song-page__favorite');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  const slug = btn.dataset.slug;
  if (!slug) return;
  const nowFavorited = Favorites.toggle(slug);

  if (nowFavorited === null) {
    if (typeof Toast !== 'undefined') Toast.show(I18n.t('toast.favorites_consent_required'), { type: 'warning' });
    return;
  }

  // Keep every button for this song in sync (it can appear in more than one grid at once).
  document.querySelectorAll(`.song-card__favorite[data-slug="${CSS.escape(slug)}"], .song-page__favorite[data-slug="${CSS.escape(slug)}"]`)
    .forEach((el) => updateFavoriteButton(el, nowFavorited));

  if (typeof Toast !== 'undefined') {
    Toast.show(I18n.t(nowFavorited ? 'toast.added_to_favorites' : 'toast.removed_from_favorites'), { type: 'success', duration: 2000 });
  }
});

// ─── App Initialization ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize cookie consent
  if (typeof CookieConsent !== 'undefined') CookieConsent.init();

  // Initialize i18n first
  try {
    await I18n.init();
  } catch (err) {
    console.warn('I18n.init failed:', err);
  }

  initAppPromotion();
  CalendarFeature.init();
  CalendarPrefs.initSelect();
  NotificationsFeature.init();
  // The calendar prompt (first visit only) goes first — once it's dismissed
  // (or skipped immediately, on a returning visit), the app promo dialog
  // follows on its usual delay, instead of the two stacking on top of each other.
  setTimeout(() => {
    CalendarPrefs.promptIfNeeded().then(() => {
      setTimeout(initAppPromotionDialog, 400);
    });
  }, 900);

  // Initialize theme
  Theme.init();

  // Restore the card/list display preference on every song grid on this page
  DisplayMode.init();

  // Settings + Notifications panel toggle(s) — opening one closes the other.
  const dropdownToggles = document.querySelectorAll('.settings-toggle, .notif-toggle');
  if (dropdownToggles.length) {
    dropdownToggles.forEach((wrap) => {
      const btn = wrap.querySelector('.settings-toggle__btn, .notif-toggle__btn');
      if (!btn) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownToggles.forEach((other) => {
          if (other !== wrap) other.classList.remove('open');
        });
        wrap.classList.toggle('open');
      });
    });

    document.addEventListener('click', (e) => {
      dropdownToggles.forEach((wrap) => {
        if (!wrap.contains(e.target)) wrap.classList.remove('open');
      });
    });
  }

  // Ensure notifications and settings (language + theme) are available in the mobile
  // drawer on small screens. We move the existing elements into the drawer when the
  // header menu is visible (small screens), and restore them back on larger screens.
  // Moving preserves event listeners and keeps behavior consistent.
  function attachToggleToDrawer(selector) {
    const toggle = document.querySelector(selector);
    const menuBtn = document.querySelector('.header__menu-btn');
    const mobileDrawer = document.querySelector('.mobile-drawer');
    const mobileDrawerContent = document.querySelector('.mobile-drawer__content');

    if (!toggle || !menuBtn || !mobileDrawer || !mobileDrawerContent) return;

    const originalParent = toggle.parentElement;
    const originalNext = toggle.nextElementSibling;
    let moved = false;

    function updatePlacement() {
      const menuVisible = window.getComputedStyle(menuBtn).display !== 'none';
      if (menuVisible && !moved) {
        mobileDrawerContent.appendChild(toggle);
        toggle.classList.remove('open');
        moved = true;
      } else if (!menuVisible && moved) {
        if (originalNext) originalParent.insertBefore(toggle, originalNext);
        else originalParent.appendChild(toggle);
        toggle.classList.remove('open');
        moved = false;
      }
    }

    // Update on load and on resize
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
  }
  attachToggleToDrawer('.notif-toggle');
  attachToggleToDrawer('.settings-toggle');

  // Mobile drawer toggle
  const menuBtn = document.querySelector('.header__menu-btn');
  const mobileDrawer = document.querySelector('.mobile-drawer');
  const mobileDrawerClose = document.querySelector('.mobile-drawer__close');
  const mobileDrawerBackdrop = document.querySelector('.mobile-drawer__backdrop');
  const mobileDrawerLinks = document.querySelectorAll('.mobile-drawer__link');

  const closeMobileDrawer = () => {
    if (!mobileDrawer || !menuBtn) return;
    mobileDrawer.classList.remove('open');
    mobileDrawer.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
  };

  const openMobileDrawer = () => {
    if (!mobileDrawer || !menuBtn) return;
    mobileDrawer.classList.add('open');
    mobileDrawer.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');
  };

  if (menuBtn && mobileDrawer) {
    menuBtn.addEventListener('click', () => {
      if (mobileDrawer.classList.contains('open')) {
        closeMobileDrawer();
      } else {
        openMobileDrawer();
      }
    });

    if (mobileDrawerClose) mobileDrawerClose.addEventListener('click', closeMobileDrawer);
    if (mobileDrawerBackdrop) mobileDrawerBackdrop.addEventListener('click', closeMobileDrawer);
    mobileDrawerLinks.forEach((link) => link.addEventListener('click', closeMobileDrawer));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileDrawer.classList.contains('open')) closeMobileDrawer();
    });

    window.addEventListener('resize', () => {
      const menuVisible = window.getComputedStyle(menuBtn).display !== 'none';
      if (!menuVisible && mobileDrawer.classList.contains('open')) {
        closeMobileDrawer();
      }
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
    case 'article':
      ArticlePage.init();
      break;
    case 'articles':
      ArticlesPage.init();
      break;
    default:
      HomePage.init();
      break;
  }
});
