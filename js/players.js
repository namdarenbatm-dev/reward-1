/*
 * players.js — ساخت state، مدیریت پلیرها، نرمال‌سازی داده و اعتبارسنجی
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calculations'), require('./referrals'));
  else { root.TT = root.TT || {}; root.TT.players = factory(root.TT.calc, root.TT.referrals); }
})(typeof self !== 'undefined' ? self : this, function (calc, referrals) {
  'use strict';

  const STATE_VERSION = 1;
  const TYPE_LABEL = { partner: 'شریک', agent: 'نماینده' };
  const count = v => calc.toInt(v);

  function newState() {
    return {
      version: STATE_VERSION,
      config: calc.defaultConfig(),
      players: [],
      firstPurchases: [],
      manualEvents: [],   // رویدادهای تجمیعی دستی (معرفی / ثبت شبکه)
      seq: { player: 0, fp: 0, me: 0 },
      meta: { createdAt: new Date().toISOString(), updatedAt: null }
    };
  }

  const getPlayer = (state, id) => state.players.find(p => p.id === id) || null;
  const partners = state => state.players.filter(p => p.type === 'partner');
  const agents = state => state.players.filter(p => p.type === 'agent');

  function addPlayer(state, data) {
    const name = String((data && data.name) || '').trim();
    const type = data && data.type;
    if (!name) return { ok: false, code: 'NO_NAME', reason: 'نام پلیر را وارد کنید.' };
    if (type !== 'partner' && type !== 'agent') return { ok: false, code: 'BAD_TYPE', reason: 'نوع پلیر باید شریک یا نماینده باشد.' };
    state.seq.player += 1;
    const p = {
      id: 'P-' + String(state.seq.player).padStart(3, '0'),
      name, type,
      partnerId: type === 'agent' ? (data.partnerId || null) : null,
      referrerId: null,
      regDevices: count(data.regDevices),
      targetDevices: count(data.targetDevices)
    };
    if (type === 'agent') { p.registrationCompleted = !!data.registrationCompleted; p.docsApproved = !!data.docsApproved; }
    state.players.push(p);
    if (type === 'agent' && data.referrerId) {
      const r = referrals.setReferrer(state, p.id, data.referrerId);
      if (!r.ok) { state.players.pop(); state.seq.player -= 1; return r; }
    }
    return { ok: true, player: p };
  }

  /** ویرایش فیلدهای مجاز؛ نوع پلیر پس از ایجاد قابل تغییر نیست */
  function updatePlayer(state, id, patch) {
    const p = getPlayer(state, id);
    if (!p) return { ok: false, code: 'NO_PLAYER', reason: 'پلیر یافت نشد.' };
    if ('name' in patch) p.name = String(patch.name || '').trim() || p.name;
    if ('regDevices' in patch) p.regDevices = count(patch.regDevices);
    if ('targetDevices' in patch) p.targetDevices = count(patch.targetDevices);
    if (p.type === 'agent') {
      if ('registrationCompleted' in patch) p.registrationCompleted = !!patch.registrationCompleted;
      if ('docsApproved' in patch) p.docsApproved = !!patch.docsApproved;
    }
    if ('partnerId' in patch && p.type === 'agent') {
      const pid = patch.partnerId || null;
      if (pid && (!getPlayer(state, pid) || getPlayer(state, pid).type !== 'partner')) {
        return { ok: false, code: 'BAD_PARTNER', reason: 'شریک انتخاب‌شده معتبر نیست.' };
      }
      p.partnerId = pid;
    }
    if ('referrerId' in patch && p.type === 'agent') {
      const r = referrals.setReferrer(state, id, patch.referrerId || null);
      if (!r.ok) return r;
    }
    return { ok: true, player: p };
  }

  /** حذف پلیر + پاک‌سازی ارجاعات وابسته (خرید اولیه، معرفی‌ها، عضویت در شبکه) */
  function removePlayer(state, id) {
    const i = state.players.findIndex(p => p.id === id);
    if (i < 0) return { ok: false, code: 'NO_PLAYER', reason: 'پلیر یافت نشد.' };
    const removed = state.players.splice(i, 1)[0];
    state.firstPurchases = (state.firstPurchases || []).filter(e => e.agentId !== id);
    state.manualEvents = (state.manualEvents || []).filter(e => e.payeeId !== id);
    state.players.forEach(p => {
      if (p.referrerId === id) p.referrerId = null;
      if (p.partnerId === id) p.partnerId = null;
    });
    return { ok: true, player: removed };
  }

  /* ---------- رویداد تجمیعی دستی ----------
   * kind: REF = معرفی (دریافت‌کننده نماینده → حق معرفی نماینده؛ شریک → حق معرفی توسط شریک)
   *       OLD_REG / NEW_REG = حق ثبت نماینده قدیم/جدید به شریک (فقط دریافت‌کنندهٔ شریک)
   * count = تعداد نماینده (آمار)، devices = تعداد دستگاه (مبنای مبلغ: دستگاه × نرخ) */
  const ME_KINDS = ['REF', 'OLD_REG', 'NEW_REG'];
  function addManualEvent(state, d) {
    const payee = getPlayer(state, d && d.payeeId);
    if (!payee) return { ok: false, code: 'NO_PAYEE', reason: 'دریافت‌کننده را انتخاب کنید.' };
    const kind = d.kind || 'REF';
    if (!ME_KINDS.includes(kind)) return { ok: false, code: 'BAD_KIND', reason: 'نوع رویداد نامعتبر است.' };
    if (kind !== 'REF' && payee.type !== 'partner') return { ok: false, code: 'KIND_PARTNER_ONLY', reason: 'حق ثبت قدیم/جدید فقط به شریک تعلق می‌گیرد.' };
    state.seq.me = (state.seq.me || 0) + 1;
    const e = { id: 'ME-' + String(state.seq.me).padStart(4, '0'), payeeId: payee.id, kind, count: count(d.count), devices: count(d.devices) };
    state.manualEvents.push(e);
    return { ok: true, event: e };
  }
  function updateManualEvent(state, id, patch) {
    const e = (state.manualEvents || []).find(x => x.id === id);
    if (!e) return { ok: false, code: 'NO_EVENT', reason: 'رویداد یافت نشد.' };
    if ('count' in patch) e.count = count(patch.count);
    if ('devices' in patch) e.devices = count(patch.devices);
    if ('kind' in patch || 'payeeId' in patch) {
      const payee = getPlayer(state, 'payeeId' in patch ? patch.payeeId : e.payeeId);
      const kind = 'kind' in patch ? patch.kind : e.kind;
      if (!payee || !ME_KINDS.includes(kind)) return { ok: false, code: 'BAD_EVENT', reason: 'مقدار نامعتبر.' };
      if (kind !== 'REF' && payee.type !== 'partner') return { ok: false, code: 'KIND_PARTNER_ONLY', reason: 'حق ثبت قدیم/جدید فقط به شریک تعلق می‌گیرد.' };
      e.payeeId = payee.id; e.kind = kind;
    }
    return { ok: true, event: e };
  }
  function removeManualEvent(state, id) {
    const n = (state.manualEvents || []).length;
    state.manualEvents = (state.manualEvents || []).filter(x => x.id !== id);
    return { ok: state.manualEvents.length < n };
  }

  /** اعتبارسنجی منطقی ورودی‌ها (هشدار/خطا؛ محاسبه را متوقف نمی‌کند) */
  function validate(state) {
    const issues = [];
    const names = {};
    state.players.forEach(p => {
      names[p.name] = (names[p.name] || 0) + 1;
      if (p.targetDevices > p.regDevices) {
        issues.push({ level: 'error', code: 'TARGET_GT_REG', playerId: p.id,
          msg: `«${p.name}»: دستگاه مشمول تارگت (${p.targetDevices}) از دستگاه ثبت‌شده (${p.regDevices}) بیشتر است.` });
      }
      if (p.type === 'agent') {
        const fp = referrals.getFirstPurchase(state, p.id);
        if (!p.partnerId) issues.push({ level: 'warn', code: 'NO_PARTNER', playerId: p.id,
          msg: `«${p.name}» شریک مربوطه ندارد؛ حق ثبت نماینده به شریک (قدیم/جدید) برای او محاسبه نمی‌شود.` });
        if (fp && fp.devices > p.regDevices) issues.push({ level: 'error', code: 'FP_GT_REG', playerId: p.id,
          msg: `«${p.name}»: خرید اولیه (${fp.devices}) از کل دستگاه ثبت‌شده (${p.regDevices}) بیشتر است.` });
        if (p.referrerId) {
          const st = referrals.referralStatus(state, p);
          if (!st.eligible) issues.push({ level: 'info', code: 'REF_PENDING', playerId: p.id,
            msg: `«${p.name}» معرفی شده اما شرایط حق معرفی کامل نیست (${st.missing.join('، ')})؛ تا تکمیل، حق معرفی ایجاد نمی‌شود.` });
        }
      }
    });
    (state.manualEvents || []).forEach(e => {
      if (e.kind !== 'REF') return;   // شرط حداقل یک دستگاه خرید اولیه فقط برای حق معرفی است
      if (e.devices > 0 && e.count === 0) issues.push({ level: 'warn', code: 'ME_NO_COUNT', msg: `رویداد ${e.id}: تعداد دستگاه وارد شده ولی تعداد نماینده صفر است.` });
      if (e.count > 0 && e.devices === 0) issues.push({ level: 'warn', code: 'ME_NO_DEVICES', msg: `رویداد ${e.id}: تعداد نماینده وارد شده ولی دستگاه صفر است؛ مبلغی ایجاد نمی‌شود.` });
      if (e.devices > 0 && e.devices < e.count) issues.push({ level: 'warn', code: 'ME_DEV_LT_COUNT', msg: `رویداد ${e.id}: تعداد دستگاه (${e.devices}) از تعداد نماینده (${e.count}) کمتر است؛ حق معرفی فقط برای نمایندهٔ دارای حداقل یک دستگاه خرید اولیه ایجاد می‌شود؛ حداکثر ${e.devices} نماینده مستحق‌اند و بقیه در شمارش مستحق نمی‌آیند.` });
    });
    Object.keys(names).forEach(n => { if (names[n] > 1) issues.push({ level: 'warn', code: 'DUP_NAME', msg: `نام «${n}» برای ${names[n]} پلیر تکرار شده است.` }); });
    return issues.concat(referrals.audit(state));
  }

  /* ---------- نرمال‌سازی داده (بازیابی از ذخیره‌سازی/پشتیبان) ---------- */
  function mergeDeep(base, extra) {
    if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) return base;
    Object.keys(base).forEach(k => {
      if (!(k in extra)) return;
      if (base[k] !== null && typeof base[k] === 'object' && !Array.isArray(base[k])) base[k] = mergeDeep(base[k], extra[k]);
      else base[k] = extra[k];
    });
    return base;
  }
  function numOrNull(v) { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('ساختار داده نامعتبر است.');
    const s = newState();
    s.config = mergeDeep(calc.defaultConfig(), raw.config || {});
    // مقادیر override باید عدد یا null باشند
    ['targetRateOverride'].forEach(k => { s.config.partner[k] = numOrNull(s.config.partner[k]); });
    ['approvedPriceOverride', 'budgetOverride'].forEach(k => { s.config.agent[k] = numOrNull(s.config.agent[k]); });

    const ids = new Set();
    // مهاجرت غیرمخرب: دادهٔ قدیمی فیلدهای ثبت‌نام/مدارک ندارد؛ نمایندگانی که قبلاً خرید اولیه‌شان ثبت شده «تکمیل/تأیید» فرض می‌شوند تا مبالغ قبلی تغییر نکند
    const legacyFp = new Set((Array.isArray(raw.firstPurchases) ? raw.firstPurchases : []).filter(e => e && e.agentId).map(e => e.agentId));
    (Array.isArray(raw.players) ? raw.players : []).forEach(p => {
      if (!p || (p.type !== 'partner' && p.type !== 'agent') || !p.id || ids.has(p.id)) return;
      ids.add(p.id);
      const np = {
        id: String(p.id), name: String(p.name || 'بدون نام'), type: p.type,
        partnerId: p.type === 'agent' ? (p.partnerId || null) : null,
        referrerId: p.type === 'agent' ? (p.referrerId || null) : null,
        regDevices: count(p.regDevices), targetDevices: count(p.targetDevices)
      };
      if (p.type === 'agent') {
        np.registrationCompleted = typeof p.registrationCompleted === 'boolean' ? p.registrationCompleted : legacyFp.has(p.id);
        np.docsApproved = typeof p.docsApproved === 'boolean' ? p.docsApproved : legacyFp.has(p.id);
      }
      s.players.push(np);
    });
    const agentSeen = new Set();
    (Array.isArray(raw.firstPurchases) ? raw.firstPurchases : []).forEach(e => {
      if (!e || !e.id || !ids.has(e.agentId) || agentSeen.has(e.agentId)) return; // حذف تکراری/یتیم
      agentSeen.add(e.agentId);
      s.firstPurchases.push({ id: String(e.id), agentId: e.agentId, devices: count(e.devices), createdAt: e.createdAt || null });
    });
    const kindsOk = ['REF', 'OLD_REG', 'NEW_REG'];
    (Array.isArray(raw.manualEvents) ? raw.manualEvents : []).forEach(e => {
      if (!e || !e.id || !ids.has(e.payeeId) || !kindsOk.includes(e.kind)) return;
      const payee = s.players.find(p => p.id === e.payeeId);
      if (e.kind !== 'REF' && payee.type !== 'partner') return;
      if (s.manualEvents.some(x => x.id === String(e.id))) return;
      s.manualEvents.push({ id: String(e.id), payeeId: e.payeeId, kind: e.kind, count: count(e.count), devices: count(e.devices) });
    });
    const maxNum = (arr, re) => arr.reduce((m, x) => { const t = re.exec(x); return t ? Math.max(m, Number(t[1])) : m; }, 0);
    s.seq.player = Math.max(Number(raw.seq && raw.seq.player) || 0, maxNum(s.players.map(p => p.id), /^P-(\d+)$/));
    s.seq.fp = Math.max(Number(raw.seq && raw.seq.fp) || 0, maxNum(s.firstPurchases.map(e => e.id), /^FP-(\d+)$/));
    s.seq.me = Math.max(Number(raw.seq && raw.seq.me) || 0, maxNum(s.manualEvents.map(e => e.id), /^ME-(\d+)$/));
    s.meta = Object.assign(s.meta, raw.meta || {});
    return s;
  }

  /** داده نمونه (برای آزمون سریع؛ قابل پاک‌سازی) */
  function sampleState() {
    const s = newState();
    const P1 = addPlayer(s, { name: 'شریک نمونه ۱', type: 'partner', regDevices: 20, targetDevices: 12 }).player;
    const A1 = addPlayer(s, { name: 'نماینده الف', type: 'agent', partnerId: P1.id, regDevices: 15, targetDevices: 8 }).player;
    const A2 = addPlayer(s, { name: 'نماینده ب', type: 'agent', partnerId: P1.id, regDevices: 12, targetDevices: 6 }).player;
    const A3 = addPlayer(s, { name: 'نماینده ج', type: 'agent', partnerId: P1.id, regDevices: 8, targetDevices: 3 }).player;
    [A1, A2, A3].forEach(a => { a.registrationCompleted = true; a.docsApproved = true; });
    referrals.setReferrer(s, A1.id, P1.id);   // الف توسط شریک معرفی شده
    referrals.setReferrer(s, A2.id, A1.id);   // ب توسط الف
    referrals.setReferrer(s, A3.id, A2.id);   // ج توسط ب (الف بابت ج سهمی ندارد)
    referrals.registerFirstPurchase(s, A1.id, 10);
    referrals.registerFirstPurchase(s, A2.id, 10);
    referrals.registerFirstPurchase(s, A3.id, 8);
    return s;
  }

  return {
    STATE_VERSION, TYPE_LABEL, newState, normalizeState, sampleState,
    getPlayer, partners, agents, addPlayer, updatePlayer, removePlayer, validate,
    addManualEvent, updateManualEvent, removeManualEvent, ME_KINDS
  };
});
