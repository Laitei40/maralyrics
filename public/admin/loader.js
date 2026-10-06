// ┌───────────────────────────────────────────────┐
// │   MaraLyrics — Admin loading & feedback layer  │
// └───────────────────────────────────────────────┘
// Splash screen, top progress bar, skeleton table rows, busy buttons and a thin
// wrapper over the shared Toast module. Plain <script> (loaded before index.js).

'use strict';

const AdminUI = (() => {
  // ─── Top progress bar: visible while any API request is in flight ──
  let inflight = 0;
  let bar = null;
  let showTimer = null;
  let hideTimer = null;

  function getBar() {
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'admin-progress';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', 'Loading');
      bar.innerHTML = '<span></span>';
      document.body.appendChild(bar);
    }
    return bar;
  }

  function begin() {
    inflight++;
    clearTimeout(hideTimer);
    // Only show for requests slower than 120ms so quick ones don't flicker.
    if (inflight === 1) showTimer = setTimeout(() => getBar().classList.add('is-active'), 120);
  }

  function end() {
    inflight = Math.max(0, inflight - 1);
    if (inflight > 0) return;
    clearTimeout(showTimer);
    if (!bar || !bar.classList.contains('is-active')) return;
    bar.classList.add('is-done');
    hideTimer = setTimeout(() => bar.classList.remove('is-active', 'is-done'), 350);
  }

  /** Track a promise (or promise-returning fn) on the progress bar. */
  function track(p) {
    begin();
    const promise = typeof p === 'function' ? p() : p;
    return Promise.resolve(promise).finally(end);
  }

  // ─── Splash screen (first paint until the session check finishes) ──
  function hideSplash() {
    const el = document.getElementById('adminSplash');
    if (!el || el.classList.contains('is-hidden')) return;
    el.classList.add('is-hidden');
    el.setAttribute('aria-hidden', 'true');
    setTimeout(() => el.remove(), 450);
  }

  // ─── Skeleton rows for tables ─────────────────────────────────────
  function loadingRows(cols, rows = 5) {
    const widths = [55, 80, 40, 65, 30, 70, 50, 60];
    const cells = (r) => Array.from({ length: cols }, (_, c) =>
      `<td><span class="skel-bar" style="width:${widths[(r + c * 3) % widths.length]}%"></span></td>`).join('');
    return Array.from({ length: rows }, (_, r) => `<tr class="skel-row" aria-hidden="true">${cells(r)}</tr>`).join('') +
      '<tr class="sr-only-row"><td colspan="' + cols + '"><span class="sr-only" role="status">Loading…</span></td></tr>';
  }

  // ─── Busy button (spinner + disabled) ─────────────────────────────
  function setBusy(btn, busy) {
    if (!btn) return;
    btn.classList.toggle('is-busy', busy);
    if (busy) {
      btn.dataset.wasDisabled = btn.disabled ? '1' : '';
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    } else {
      btn.disabled = btn.dataset.wasDisabled === '1';
      delete btn.dataset.wasDisabled;
      btn.removeAttribute('aria-busy');
    }
  }

  /** The button the user just pressed, if the call was triggered by one. */
  function activeButton() {
    const el = document.activeElement;
    return el && el.tagName === 'BUTTON' && !el.disabled && !el.closest('.skip-busy') ? el : null;
  }

  // ─── Toasts ───────────────────────────────────────────────────────
  function notify(message, type = 'info', opts = {}) {
    if (typeof Toast !== 'undefined') Toast.show(message, { type, duration: type === 'error' ? 5000 : 3500, ...opts });
  }
  const success = (m, o) => notify(m, 'success', o);
  const error = (m, o) => notify(m, 'error', o);

  /** Replacement for window.alert(): non-blocking toast; picks error vs warning from the wording. */
  function alertToast(message) {
    notify(String(message), /fail|could not|error|invalid|denied/i.test(message) ? 'error' : 'warning');
  }

  // A toast to show after the next full page load (login redirect, logout reload).
  const FLASH_KEY = 'ml_admin_flash';
  function flash(message, type = 'info') {
    try { sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, type })); } catch { /* storage unavailable */ }
  }
  function showFlash() {
    try {
      const raw = sessionStorage.getItem(FLASH_KEY);
      if (!raw) return;
      sessionStorage.removeItem(FLASH_KEY);
      const { message, type } = JSON.parse(raw);
      setTimeout(() => notify(message, type), 400);
    } catch { /* ignore */ }
  }

  return { track, hideSplash, loadingRows, setBusy, activeButton, notify, success, error, alertToast, flash, showFlash };
})();
