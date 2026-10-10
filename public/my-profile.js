// ┌───────────────────────────────────────────────┐
// │  MaraLyrics — artist & composer accounts       │
// └───────────────────────────────────────────────┘
// Sign in / create an account, ask to claim an artist or composer profile, and — once a claim is approved —
// edit that profile's bio, photo and social links. Talks to /api/v1/account (see worker/routes/account.js).
// Loaded after app.js (uses CONFIG, I18n, Utils, Toast).
(() => {
  'use strict';
  if (!document.getElementById('accountPage')) return;

  const API = `${CONFIG.API_BASE}/account`;
  const TOKEN_KEY = 'ml_account_token';
  const TURNSTILE_SITEKEY = '0x4AAAAAABjildkegfR6T0sd'; // same public site key as the feedback forms
  const PHOTO_SIZE = 400; // uploaded photos are centre-cropped to a square this size (JPEG)
  const MAX_PHOTO_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_LINKS = 10;

  const $ = (id) => document.getElementById(id);
  const t = (key, vars) => I18n.t(key, vars);
  const esc = (s) => Utils.escapeHtml(s);

  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
    set(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
  };

  let token = store.get();
  let account = null;
  let claims = [];
  let editing = null;     // { claimId, type, slug, name }
  let photo = '';         // current photo (data: URL or https URL), '' = none
  let links = [];         // current social links
  let target = null;      // { type, slug, name } when arriving from a profile's "Claim" link

  // ── API ─────────────────────────────────────────
  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || t('common.err_generic'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ── Cloudflare Turnstile (rendered explicitly, once per form) ──
  const widgets = {};
  function renderTurnstile(boxId, tries = 0) {
    if (widgets[boxId] !== undefined) return;
    if (!window.turnstile) { if (tries < 40) setTimeout(() => renderTurnstile(boxId, tries + 1), 250); return; }
    widgets[boxId] = window.turnstile.render(`#${boxId}`, { sitekey: TURNSTILE_SITEKEY, theme: 'dark' });
  }
  const turnstileToken = (boxId) => (widgets[boxId] !== undefined && window.turnstile ? window.turnstile.getResponse(widgets[boxId]) : '') || '';
  const turnstileReset = (boxId) => { if (widgets[boxId] !== undefined && window.turnstile) window.turnstile.reset(widgets[boxId]); };

  // ── Small UI helpers ────────────────────────────
  function say(id, text, ok = false) {
    const el = $(id);
    el.textContent = text || '';
    el.hidden = !text;
    el.className = `account-message${ok ? ' account-message--ok' : ''}`;
  }
  async function busy(btn, fn) {
    btn.disabled = true;
    try { return await fn(); } finally { btn.disabled = false; }
  }
  const publicUrl = (c) => `/${c.type}/${encodeURIComponent(c.slug)}`;

  // ── Signed out ──────────────────────────────────
  function showAuth() {
    $('accountAuth').hidden = false;
    $('accountHome').hidden = true;
    if (target) {
      const note = $('authClaimNote');
      note.textContent = t('account.claim_prompt', { name: target.name });
      note.hidden = false;
      selectTab(target ? 'register' : 'signin');
    }
  }

  function selectTab(which) {
    const reg = which === 'register';
    $('tabSignin').classList.toggle('active', !reg);
    $('tabRegister').classList.toggle('active', reg);
    $('signinForm').hidden = reg;
    $('registerForm').hidden = !reg;
    if (reg) renderTurnstile('regTurnstile');
  }

  async function enter(data) {
    token = data.token;
    store.set(token);
    await showHome();
  }

  $('tabSignin').addEventListener('click', () => selectTab('signin'));
  $('tabRegister').addEventListener('click', () => selectTab('register'));

  $('signinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    say('signinMsg', '');
    await busy($('signinBtn'), async () => {
      try {
        await enter(await api('POST', '/login', { username: $('signinUser').value, password: $('signinPass').value }));
        $('signinPass').value = '';
      } catch (err) { say('signinMsg', err.message); }
    });
  });

  $('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    say('regMsg', '');
    const ts = turnstileToken('regTurnstile');
    if (!ts) { say('regMsg', t('feedback.err_turnstile')); return; }
    await busy($('regBtn'), async () => {
      try {
        await enter(await api('POST', '/register', {
          username: $('regUser').value, password: $('regPass').value, contact_email: $('regEmail').value, turnstile_token: ts,
        }));
        $('regPass').value = '';
      } catch (err) { say('regMsg', err.message); turnstileReset('regTurnstile'); }
    });
  });

  // ── Signed in ───────────────────────────────────
  function signOut() {
    token = '';
    account = null;
    claims = [];
    editing = null;
    store.set('');
    $('editorCard').hidden = true;
    showAuth();
  }

  async function showHome() {
    let me;
    try { me = await api('GET', '/me'); } catch (err) {
      if (err.status === 401) { signOut(); return; }
      say('signinMsg', err.message);
      return;
    }
    account = me.account;
    claims = me.claims;
    $('accountAuth').hidden = true;
    $('accountHome').hidden = false;
    $('accountHello').textContent = t('account.signed_in_as', { name: account.username });
    if (account.contact_email && !$('claimEmail').value) $('claimEmail').value = account.contact_email;
    renderClaims();
    renderTurnstile('claimTurnstile');
    renderClaimTarget();
  }

  $('btnSignout').addEventListener('click', signOut);
  $('btnShowPassword').addEventListener('click', () => { $('passwordForm').hidden = !$('passwordForm').hidden; say('pwMsg', ''); });
  $('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    say('pwMsg', '');
    try {
      await api('POST', '/change-password', { current_password: $('pwCurrent').value, new_password: $('pwNew').value });
      $('pwCurrent').value = '';
      $('pwNew').value = '';
      say('pwMsg', t('account.password_changed'), true);
    } catch (err) { say('pwMsg', err.message); }
  });

  // ── Claims list ─────────────────────────────────
  const STATUS_KEY = { pending: 'account.status_pending', approved: 'account.status_approved', rejected: 'account.status_rejected', revoked: 'account.status_revoked' };

  function renderClaims() {
    $('claimEmpty').hidden = claims.length > 0;
    $('claimList').innerHTML = claims.map((c) => `
      <article class="account-claim account-claim--${esc(c.status)}" data-id="${Number(c.id)}">
        <div class="account-claim__main">
          <a class="account-claim__name" href="${publicUrl(c)}">${esc(c.name)}</a>
          <span class="account-claim__type">${esc(t(c.type === 'artist' ? 'account.type_artist' : 'account.type_composer'))}</span>
          <span class="account-chip account-chip--${esc(c.status)}">${esc(t(STATUS_KEY[c.status] || c.status))}</span>
        </div>
        ${c.review_note ? `<p class="account-claim__note">${esc(t('account.note_from_team', { note: c.review_note }))}</p>` : ''}
        <div class="account-claim__actions">
          ${c.status === 'approved' ? `<button type="button" class="btn btn--primary btn--sm" data-action="edit">${esc(t('account.edit_profile'))}</button>` : ''}
          ${c.status === 'pending' ? `<button type="button" class="btn btn--ghost btn--sm" data-action="withdraw">${esc(t('account.withdraw'))}</button>` : ''}
        </div>
      </article>`).join('');
  }

  $('claimList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = Number(btn.closest('.account-claim').dataset.id);
    const claim = claims.find((c) => c.id === id);
    if (!claim) return;
    if (btn.dataset.action === 'edit') await openEditor(claim);
    if (btn.dataset.action === 'withdraw' && window.confirm(t('account.withdraw_confirm'))) {
      try { await api('DELETE', `/claims/${id}`); await refreshClaims(); } catch (err) { Toast.show(err.message, { type: 'error' }); }
    }
  });

  async function refreshClaims() {
    const me = await api('GET', '/me');
    claims = me.claims;
    renderClaims();
  }

  // ── Claim form ──────────────────────────────────
  const names = {}; // type → [{ name, slug }]
  async function loadNames(type) {
    if (names[type]) return names[type];
    const res = await fetch(`${CONFIG.API_BASE}/${type}s`);
    const data = res.ok ? await res.json() : {};
    names[type] = (data[`${type}s`] || []).map((p) => ({ name: p.name, slug: p.slug }));
    return names[type];
  }
  async function fillNames() {
    const list = await loadNames($('claimType').value).catch(() => []);
    $('claimNames').innerHTML = list.map((p) => `<option value="${esc(p.name)}"></option>`).join('');
  }
  $('claimType').addEventListener('change', () => { $('claimSearch').value = ''; fillNames(); });
  $('claimSearch').addEventListener('focus', fillNames, { once: true });

  function renderClaimTarget() {
    const el = $('claimTarget');
    if (target) {
      el.textContent = t('account.claiming', { name: target.name });
      el.hidden = false;
      $('claimPicker').hidden = true;
    } else {
      el.hidden = true;
      $('claimPicker').hidden = false;
    }
  }

  $('claimForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    say('claimMsg', '');
    let pick = target;
    if (!pick) {
      const typed = $('claimSearch').value.trim().toLowerCase();
      const type = $('claimType').value;
      const matches = typed ? (await loadNames(type).catch(() => [])).filter((p) => p.name.toLowerCase() === typed) : [];
      if (!matches.length) { say('claimMsg', t('account.claim_pick')); return; }
      if (matches.length > 1) { say('claimMsg', t('account.claim_ambiguous')); return; }
      pick = { type, slug: matches[0].slug, name: matches[0].name };
    }
    const ts = turnstileToken('claimTurnstile');
    if (!ts) { say('claimMsg', t('feedback.err_turnstile')); return; }
    await busy($('claimBtn'), async () => {
      try {
        await api('POST', '/claims', { type: pick.type, slug: pick.slug, evidence: $('claimEvidence').value, contact_email: $('claimEmail').value, turnstile_token: ts });
        $('claimEvidence').value = '';
        $('claimSearch').value = '';
        target = null;
        renderClaimTarget();
        history.replaceState(null, '', location.pathname);
        say('claimMsg', t('account.claim_sent'), true);
        await refreshClaims();
      } catch (err) { say('claimMsg', err.message); }
      turnstileReset('claimTurnstile');
    });
  });

  // ── Profile editor ──────────────────────────────
  function renderPhoto() {
    const box = $('editorPhoto');
    box.innerHTML = photo ? `<img src="${esc(photo)}" alt="" />` : `<span aria-hidden="true">${esc((editing?.name || '?').charAt(0).toUpperCase())}</span>`;
    $('editorPhotoRemove').hidden = !photo;
  }

  function renderLinks() {
    $('editorLinks').innerHTML = links.map((url, i) => `
      <div class="account-link-row">
        <span class="account-link-icon" title="${esc(SocialIcons.detect(url, { websiteLabel: t('common.website') }).name)}">${SocialIcons.detect(url).icon}</span>
        <input type="url" class="form-input" value="${esc(url)}" data-i="${i}" placeholder="${esc(t('account.social_ph'))}" maxlength="500" />
        <button type="button" class="btn btn--ghost btn--sm" data-remove="${i}" aria-label="${esc(t('account.social_remove'))}">✕</button>
      </div>`).join('');
    $('editorAddLink').hidden = links.length >= MAX_LINKS;
  }

  const countBio = () => { $('editorBioCount').textContent = `${$('editorBio').value.length} / 5000`; };

  async function openEditor(claim) {
    say('editorMsg', '');
    try {
      const p = await api('GET', `/claims/${claim.id}/profile`);
      editing = { claimId: claim.id, type: p.type, slug: p.slug, name: p.name };
      photo = p.image_url || '';
      links = p.social_links.slice();
      $('editorBio').value = p.bio;
      $('editorTitle').textContent = t('account.editor_title', { name: p.name });
      $('editorView').href = `/${p.type}/${encodeURIComponent(p.slug)}`;
      renderPhoto();
      renderLinks();
      countBio();
      $('editorCard').hidden = false;
      $('editorCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      Toast.show(err.message, { type: 'error' });
      if (err.status === 404) await refreshClaims(); // the claim was revoked meanwhile
    }
  }

  $('editorBio').addEventListener('input', countBio);
  $('editorAddLink').addEventListener('click', () => { links.push(''); renderLinks(); $('editorLinks').lastElementChild?.querySelector('input').focus(); });
  $('editorLinks').addEventListener('input', (e) => {
    if (e.target.dataset.i === undefined) return;
    links[Number(e.target.dataset.i)] = e.target.value;
    // Update just this row's icon (re-rendering the list would steal focus from the input).
    const found = SocialIcons.detect(e.target.value, { websiteLabel: t('common.website') });
    const icon = e.target.previousElementSibling;
    icon.innerHTML = found.icon;
    icon.title = found.name;
  });
  $('editorLinks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (b) { links.splice(Number(b.dataset.remove), 1); renderLinks(); }
  });
  $('editorPhotoRemove').addEventListener('click', () => { photo = ''; renderPhoto(); });

  // Centre-crop to a square and shrink, so a phone photo becomes a ~40 KB JPEG.
  $('editorPhotoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) { say('editorMsg', t('account.err_image')); return; }
    if (file.size > MAX_PHOTO_FILE_BYTES) { say('editorMsg', t('account.err_image_big')); return; }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = PHOTO_SIZE;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // JPEG has no alpha
      ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
      photo = canvas.toDataURL('image/jpeg', 0.85);
      say('editorMsg', '');
      renderPhoto();
    } catch { say('editorMsg', t('account.err_image')); } finally { URL.revokeObjectURL(url); }
  });

  $('editorForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editing) return;
    say('editorMsg', '');
    await busy($('editorSave'), async () => {
      try {
        const saved = await api('PUT', `/claims/${editing.claimId}/profile`, {
          bio: $('editorBio').value, image_url: photo, social_links: links.map((u) => u.trim()).filter(Boolean),
        });
        links = saved.social_links.slice();
        renderLinks();
        say('editorMsg', t('account.saved'), true);
      } catch (err) {
        say('editorMsg', err.message);
        if (err.status === 404) { $('editorCard').hidden = true; await refreshClaims(); }
      }
    });
  });

  // ── Language ────────────────────────────────────
  // app.js loads the translations asynchronously and gives no "ready" signal, so wait for ours to appear before
  // drawing anything that calls t(); and redraw the script-built parts when the visitor switches language.
  const i18nReady = () => new Promise((resolve) => {
    let tries = 0;
    const tick = () => (I18n.t('account.hero_title') !== 'account.hero_title' || tries++ > 40 ? resolve() : setTimeout(tick, 100));
    tick();
  });
  function redraw() {
    if (account) {
      $('accountHello').textContent = t('account.signed_in_as', { name: account.username });
      renderClaims();
      renderClaimTarget();
      if (editing) $('editorTitle').textContent = t('account.editor_title', { name: editing.name });
    } else if (target) {
      $('authClaimNote').textContent = t('account.claim_prompt', { name: target.name });
    }
  }
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  // ── Start ───────────────────────────────────────
  async function init() {
    await i18nReady();
    // Arrived from a profile's "Claim this profile" link: /my-profile?claim=artist:ann-artist
    const m = /^(artist|composer):([\w-]+)$/.exec(new URLSearchParams(location.search).get('claim') || '');
    if (m) {
      try {
        const res = await fetch(`${CONFIG.API_BASE}/${m[1]}s/${encodeURIComponent(m[2])}`);
        if (res.ok) { const p = await res.json(); if (!p.claimed) target = { type: m[1], slug: m[2], name: p.name }; }
      } catch { /* the picker still works */ }
    }
    if (token) await showHome(); else showAuth();
  }
  init();
})();
