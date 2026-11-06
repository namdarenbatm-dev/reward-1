/*
 * referrals.js — قوانین معرفی و رویداد «خرید اولیه»
 *
 * قوانین:
 *  ۱) حق معرفی فقط با «خرید اولیه» نماینده معرفی‌شده ایجاد می‌شود (نه با ثبت‌نام/معرفی).
 *  ۲) هر نماینده فقط یک رویداد خرید اولیه دارد (شناسهٔ یکتا FP-xxxx)؛ ثبت تکراری ممنوع است.
 *  ۳) ویرایش تعداد، همان رویداد را اصلاح می‌کند؛ پرداخت جدید ایجاد نمی‌شود.
 *  ۴) فقط معرف مستقیم پاداش می‌گیرد؛ نسل‌های بعدی هیچ سهمی ندارند.
 *  ۵) تعداد معرفی‌های مستقیم هر معرف هیچ سقفی ندارد.
 *  ۶) حق معرفی فقط وقتی «مستحق» است که سه شرط همزمان برقرار باشد: ثبت‌نام تکمیل، مدارک تأیید، خرید اولیه انجام‌شده.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.TT = root.TT || {}; root.TT.referrals = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const byId = (state, id) => state.players.find(p => p.id === id) || null;
  const pad = (n, w) => String(n).padStart(w, '0');
  const posInt = v => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

  function referralsOf(state, referrerId) {
    return state.players.filter(p => p.type === 'agent' && p.referrerId === referrerId);
  }

  /** تعیین معرف مستقیم یک نماینده (بدون سقف تعداد؛ فقط خودمعرفی و معرفی متقابل ممنوع است) */
  function setReferrer(state, agentId, referrerId) {
    const agent = byId(state, agentId);
    if (!agent || agent.type !== 'agent') return { ok: false, code: 'NO_AGENT', reason: 'نماینده یافت نشد.' };
    if (!referrerId) { agent.referrerId = null; return { ok: true }; }
    if (referrerId === agentId) return { ok: false, code: 'SELF', reason: 'نماینده نمی‌تواند خودش را معرفی کند.' };
    const ref = byId(state, referrerId);
    if (!ref) return { ok: false, code: 'NO_REFERRER', reason: 'معرف یافت نشد.' };
    if (ref.type === 'agent' && ref.referrerId === agentId) {
      return { ok: false, code: 'MUTUAL', reason: 'معرفی متقابل مجاز نیست.' };
    }
    agent.referrerId = referrerId;
    return { ok: true };
  }

  function getFirstPurchase(state, agentId) {
    return (state.firstPurchases || []).find(e => e.agentId === agentId) || null;
  }

  /** ثبت خرید اولیه؛ اگر قبلاً ثبت شده باشد DUPLICATE برمی‌گرداند (و رویداد جدیدی نمی‌سازد) */
  function registerFirstPurchase(state, agentId, devices) {
    const agent = byId(state, agentId);
    if (!agent || agent.type !== 'agent') return { ok: false, code: 'NO_AGENT', reason: 'خرید اولیه فقط برای نماینده ثبت می‌شود.' };
    const n = posInt(devices);
    if (n < 1) return { ok: false, code: 'BAD_QTY', reason: 'تعداد دستگاه خرید اولیه باید حداقل ۱ باشد.' };
    const existing = getFirstPurchase(state, agentId);
    if (existing) {
      return { ok: false, code: 'DUPLICATE', existing,
        reason: `برای «${agent.name}» قبلاً خرید اولیه (${existing.id}) ثبت شده است؛ برای اصلاح، همان رویداد را ویرایش کنید.` };
    }
    state.seq = state.seq || { player: 0, fp: 0 };
    state.seq.fp += 1;
    const event = { id: 'FP-' + pad(state.seq.fp, 4), agentId, devices: n, createdAt: new Date().toISOString() };
    state.firstPurchases = state.firstPurchases || [];
    state.firstPurchases.push(event);
    return { ok: true, event };
  }

  /** اصلاح تعداد خرید اولیه روی همان رویداد (بدون ساخت پرداخت جدید) */
  function updateFirstPurchase(state, eventId, devices) {
    const e = (state.firstPurchases || []).find(x => x.id === eventId);
    if (!e) return { ok: false, code: 'NO_EVENT', reason: 'رویداد خرید اولیه یافت نشد.' };
    const n = posInt(devices);
    if (n < 1) return { ok: false, code: 'BAD_QTY', reason: 'تعداد باید حداقل ۱ باشد؛ برای حذف از گزینهٔ حذف استفاده کنید.' };
    e.devices = n; e.updatedAt = new Date().toISOString();
    return { ok: true, event: e };
  }

  function removeFirstPurchase(state, eventId) {
    const i = (state.firstPurchases || []).findIndex(x => x.id === eventId);
    if (i < 0) return { ok: false, code: 'NO_EVENT', reason: 'رویداد یافت نشد.' };
    state.firstPurchases.splice(i, 1);
    return { ok: true };
  }

  /** وضعیت استحقاق حق معرفی برای یک نماینده: هر سه شرط باید برقرار باشد */
  function referralStatus(state, agent) {
    const fp = getFirstPurchase(state, agent.id);
    const missing = [];
    if (!agent.registrationCompleted) missing.push('تکمیل ثبت‌نام');
    if (!agent.docsApproved) missing.push('تأیید مدارک');
    if (!fp || posInt(fp.devices) < 1) missing.push('خرید اولیه');
    return { eligible: missing.length === 0, missing, event: fp };
  }

  /**
   * منابع معتبر حق معرفی: برای هر خرید اولیه، فقط معرف مستقیم نماینده.
   * هیچ پیمایش زنجیره‌ای (نسل بعد) انجام نمی‌شود.
   */
  function referralSources(state) {
    const out = [];
    const seen = new Set();
    (state.firstPurchases || []).forEach(ev => {
      if (seen.has(ev.agentId)) return;          // دفاع در برابر داده‌های تکراری (شمارش دوباره ممنوع)
      seen.add(ev.agentId);
      const agent = byId(state, ev.agentId);
      if (!agent || agent.type !== 'agent' || !agent.referrerId) return;
      const referrer = byId(state, agent.referrerId);
      if (!referrer) return;
      if (!referralStatus(state, agent).eligible) return;   // سه شرط: ثبت‌نام + تأیید مدارک + خرید اولیه
      const devices = posInt(ev.devices);
      if (devices < 1) return;
      out.push({ event: ev, agent, referrer, devices });
    });
    return out;
  }

  /** ممیزی داده‌ها: تکراری بودن رویداد، مرجع‌های ناموجود */
  function audit(state) {
    const issues = [];
    state.players.filter(p => p.type === 'agent' && p.referrerId).forEach(a => {
      if (!byId(state, a.referrerId)) issues.push({ level: 'error', code: 'REF_MISSING', msg: `معرف «${a.name}» در فهرست پلیرها نیست.` });
    });
    const seen = {};
    (state.firstPurchases || []).forEach(e => {
      if (seen[e.agentId]) issues.push({ level: 'error', code: 'FP_DUP', msg: `برای نمایندهٔ ${e.agentId} بیش از یک خرید اولیه ثبت شده (${seen[e.agentId]}, ${e.id}).` });
      seen[e.agentId] = e.id;
      if (!byId(state, e.agentId)) issues.push({ level: 'error', code: 'FP_ORPHAN', msg: `خرید اولیه ${e.id} به نماینده‌ای وصل نیست.` });
    });
    return issues;
  }

  return {
    referralsOf, setReferrer, referralStatus,
    getFirstPurchase, registerFirstPurchase, updateFirstPurchase, removeFirstPurchase,
    referralSources, audit
  };
});
