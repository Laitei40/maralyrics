// ╔══════════════════════════════════════════════════════════════╗
// ║        MaraLyrics — Internationalization (i18n) Module      ║
// ║        JSON-based · data-i18n attributes · localStorage     ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

const I18n = (() => {
  const STORAGE_KEY = 'ml_lang';
  const DEFAULT_LANG = 'en';
  const SUPPORTED_LANGS = [
    { code: 'en',  name: 'English' },
    { code: 'mra', name: 'Mara' },
    { code: 'my',  name: 'မြန်မာ' },
  ];

  let currentLang = DEFAULT_LANG;
  let translations = {};
  let fallback = {};

  // ─── Helpers ─────────────────────────────────────────

  /** Get nested value from object by dot-path key, e.g. "nav.home" */
  function resolve(obj, key) {
    return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }

  /** Interpolate {variable} placeholders */
  function interpolate(str, vars) {
    if (!vars || typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
  }

  // ─── Core API ────────────────────────────────────────

  /** Translate a key. Falls back to English, then returns the key itself. */
  function t(key, vars) {
    let val = resolve(translations, key);
    if (val === undefined) val = resolve(fallback, key);
    if (val === undefined) return key;
    return interpolate(String(val), vars);
  }

  /** Load a JSON translation file. */
  async function loadTranslations(lang) {
    try {
      const res = await fetch(`/locales/${lang}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[i18n] Failed to load ${lang}.json:`, err);
      return null;
    }
  }

  /** Apply translations to all elements with data-i18n attributes. */
  function applyToDOM() {
    // data-i18n → textContent / innerHTML
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (val !== key) {
        // If translation contains HTML tags, use innerHTML; otherwise textContent
        if (/<[a-z][\s\S]*>/i.test(val)) {
          el.innerHTML = val;
        } else {
          el.textContent = val;
        }
      }
    });

    // data-i18n-placeholder → placeholder attribute
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = t(key);
      if (val !== key) el.placeholder = val;
    });

    // data-i18n-aria → aria-label attribute
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      const val = t(key);
      if (val !== key) el.setAttribute('aria-label', val);
    });

    // data-i18n-title → title attribute
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      const val = t(key);
      if (val !== key) el.title = val;
    });

    // Update html lang attribute
    document.documentElement.lang = currentLang;

    // Update language switcher active state
    document.querySelectorAll('.lang-switcher__btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.lang === currentLang);
    });
  }

  /** Set and persist language. */
  async function setLanguage(lang) {
    if (!SUPPORTED_LANGS.find((l) => l.code === lang)) {
      lang = DEFAULT_LANG;
    }

    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);

    // Load requested language
    const data = await loadTranslations(lang);
    if (data) {
      translations = data;
    }

    // Load English as fallback (if not already English)
    if (lang !== DEFAULT_LANG && Object.keys(fallback).length === 0) {
      const fb = await loadTranslations(DEFAULT_LANG);
      if (fb) fallback = fb;
    }

    // If English is the selected language, translations IS the fallback
    if (lang === DEFAULT_LANG) {
      fallback = translations;
    }

    applyToDOM();
  }

  /** Get saved language or detect from browser. */
  function getSavedLanguage() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED_LANGS.find((l) => l.code === saved)) {
      return saved;
    }
    // Try browser language
    const browserLang = (navigator.language || '').split('-')[0];
    const match = SUPPORTED_LANGS.find((l) => l.code === browserLang);
    return match ? match.code : DEFAULT_LANG;
  }

  /** Initialize i18n — call once on page load. */
  async function init() {
    const lang = getSavedLanguage();
    await setLanguage(lang);
    bindSwitcher();
  }

  /** Bind language switcher button clicks. */
  function bindSwitcher() {
    document.querySelectorAll('.lang-switcher__btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const lang = btn.dataset.lang;
        if (lang && lang !== currentLang) {
          setLanguage(lang);
        }
      });
    });
  }

  /** Get current language code. */
  function getLang() {
    return currentLang;
  }

  /** Get list of supported languages. */
  function getLanguages() {
    return SUPPORTED_LANGS;
  }

  // ─── Public API ──────────────────────────────────────
  return {
    t,
    init,
    setLanguage,
    applyToDOM,
    getLang,
    getLanguages,
  };
})();
