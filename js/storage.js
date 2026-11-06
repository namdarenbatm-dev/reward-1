/*
 * storage.js — ذخیره‌سازی خودکار در مرورگر (localStorage) + پشتیبان/بازیابی JSON
 * اگر ذخیره‌سازی در دسترس نباشد (مثلاً حالت خصوصی)، برنامه با حافظهٔ موقت کار می‌کند و کاربر مطلع می‌شود.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./players'));
  else { root.TT = root.TT || {}; root.TT.storage = factory(root.TT.players); }
})(typeof self !== 'undefined' ? self : this, function (players) {
  'use strict';

  const KEY = 'techno-reward.state.v1';
  const PREV_KEY = 'techno-reward.state.prev';
  const APP_ID = 'techno-reward-engine';
  let persistent = true;
  let timer = null;
  let pending = null;
  let lastSaved = null;
  let onSaved = null;
  const mem = {};
  let backend = null; // برای آزمون: جایگزینی موقت ذخیره‌سازی بدون دست‌زدن به داده واقعی کاربر

  function ls() { if (backend) return backend; try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }
  function rawGet(k) {
    const s = ls();
    if (!s) { persistent = false; return mem[k] || null; }
    try { return s.getItem(k); } catch (e) { persistent = false; return mem[k] || null; }
  }
  function rawSet(k, v) {
    mem[k] = v;
    const s = ls();
    if (!s) { persistent = false; return false; }
    try { s.setItem(k, v); return true; } catch (e) { persistent = false; return false; }
  }
  function rawDel(k) { delete mem[k]; const s = ls(); try { if (s) s.removeItem(k); } catch (e) { /* ignore */ } }

  function load() {
    const txt = rawGet(KEY);
    if (!txt) return { state: players.newState(), source: 'default' };
    try {
      return { state: players.normalizeState(JSON.parse(txt)), source: 'saved' };
    } catch (e) {
      // داده خراب: نسخهٔ خراب را نگه می‌داریم و با حالت پیش‌فرض شروع می‌کنیم (حذف بی‌اطلاع نداریم)
      rawSet(KEY + '.corrupt', txt);
      return { state: players.newState(), source: 'error', error: e.message };
    }
  }

  function writeNow(state) {
    state.meta = state.meta || {};
    state.meta.updatedAt = new Date().toISOString();
    const ok = rawSet(KEY, JSON.stringify(state));
    lastSaved = new Date();
    if (onSaved) onSaved({ ok, persistent, at: lastSaved });
    return ok;
  }

  /** ذخیرهٔ خودکار با تأخیر کوتاه */
  function save(state) {
    pending = state;
    clearTimeout(timer);
    timer = setTimeout(() => { if (pending) { writeNow(pending); pending = null; } }, 150);
  }
  /** ذخیرهٔ فوری (هنگام بستن صفحه/مخفی شدن) */
  function flush() {
    clearTimeout(timer);
    if (pending) { writeNow(pending); pending = null; }
  }

  function snapshotPrev(state) { rawSet(PREV_KEY, JSON.stringify({ at: new Date().toISOString(), state })); }
  function loadPrev() {
    const t = rawGet(PREV_KEY); if (!t) return null;
    try { const o = JSON.parse(t); return { at: o.at, state: players.normalizeState(o.state) }; } catch (e) { return null; }
  }
  function clearPrev() { rawDel(PREV_KEY); }
  function clearAll() { clearTimeout(timer); pending = null; rawDel(KEY); }

  /* ---------- پشتیبان JSON ---------- */
  function buildBackup(state) {
    return JSON.stringify({ app: APP_ID, schema: players.STATE_VERSION, exportedAt: new Date().toISOString(), state }, null, 2);
  }
  function parseBackup(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('فایل انتخاب‌شده JSON معتبر نیست.'); }
    if (!o || o.app !== APP_ID || !o.state) throw new Error('این فایل، پشتیبان «Techno Reward» نیست.');
    const state = players.normalizeState(o.state);
    return { state, exportedAt: o.exportedAt || null, summary: { players: state.players.length, firstPurchases: state.firstPurchases.length } };
  }

  function requestPersistence() {
    try { if (navigator.storage && navigator.storage.persist) return navigator.storage.persist(); } catch (e) { /* ignore */ }
    return Promise.resolve(false);
  }

  return {
    KEY, APP_ID, load, save, flush, snapshotPrev, loadPrev, clearPrev, clearAll,
    buildBackup, parseBackup, requestPersistence,
    useBackend: b => { backend = b || null; clearTimeout(timer); pending = null; },
    isPersistent: () => persistent,
    lastSaved: () => lastSaved,
    setOnSaved: fn => { onSaved = fn; }
  };
});
