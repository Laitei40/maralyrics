// ╔══════════════════════════════════════════════════════════════╗
// ║        MaraLyrics — Cookie Consent Manager                  ║
// ║        GDPR Compliant · Beautiful · Minimal                 ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

const CookieConsent = (() => {
  const CONSENT_KEY = 'ml_cookie_consent';

  /** Get current consent value. */
  function getConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
  }

  /** Check if user accepted all cookies (preferences included). */
  function hasConsent() {
    return getConsent() === 'accepted';
  }

  /** Check if user chose essential-only. */
  function isEssentialOnly() {
    return getConsent() === 'essential';
  }

  /** Check if user has made any consent choice. */
  function hasResponded() {
    const c = getConsent();
    return c === 'accepted' || c === 'essential';
  }

  /** Accept all cookies. */
  function accept() {
    try { localStorage.setItem(CONSENT_KEY, 'accepted'); } catch {}
    hideBanner();
  }

  /** Accept essential only — clear non-essential data. */
  function decline() {
    try { localStorage.setItem(CONSENT_KEY, 'essential'); } catch {}
    // Clear non-essential stored data
    try {
      localStorage.removeItem('ml_theme');
      localStorage.removeItem('ml_lang');
      localStorage.removeItem('ml_search_history');
    } catch {}
    hideBanner();
  }

  /** Hide the banner with animation. */
  function hideBanner() {
    const banner = document.getElementById('cookieConsent');
    if (banner) {
      banner.classList.remove('visible');
      banner.classList.add('hiding');
      setTimeout(() => banner.remove(), 500);
    }
  }

  /** Create and show the consent banner. */
  function showBanner() {
    if (document.getElementById('cookieConsent')) return;

    const banner = document.createElement('div');
    banner.id = 'cookieConsent';
    banner.className = 'cookie-consent';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');

    banner.innerHTML = `
      <div class="cookie-consent__inner">
        <div class="cookie-consent__content">
          <div class="cookie-consent__icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="8" cy="9" r="1" fill="currentColor" stroke="none"/>
              <circle cx="13" cy="7" r="1" fill="currentColor" stroke="none"/>
              <circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/>
              <circle cx="9" cy="14" r="1" fill="currentColor" stroke="none"/>
              <circle cx="14" cy="16" r="1" fill="currentColor" stroke="none"/>
            </svg>
          </div>
          <div class="cookie-consent__text">
            <p class="cookie-consent__title">We use cookies</p>
            <p class="cookie-consent__desc">This site uses cookies and local storage to save your language, theme, and search history for a better experience. <a href="/privacy" class="cookie-consent__link">Learn more</a></p>
          </div>
        </div>
        <div class="cookie-consent__actions">
          <button class="cookie-consent__btn cookie-consent__btn--accept" id="cookieAccept">Accept All</button>
          <button class="cookie-consent__btn cookie-consent__btn--decline" id="cookieDecline">Essential Only</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    // Trigger entrance animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add('visible'));
    });

    document.getElementById('cookieAccept').addEventListener('click', accept);
    document.getElementById('cookieDecline').addEventListener('click', decline);
  }

  /** Initialize — show banner if no consent decision made yet. */
  function init() {
    if (!hasResponded()) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(showBanner, 800));
      } else {
        setTimeout(showBanner, 800);
      }
    }
  }

  return { init, hasConsent, isEssentialOnly, hasResponded, accept, decline };
})();
