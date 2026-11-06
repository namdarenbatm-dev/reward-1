/*
 * calculations.js — مرجع یگانهٔ فرمول‌های مالی (مطابق فایل اکسل مدل مالی)
 * بدون وابستگی به DOM؛ قابل اجرا در مرورگر و Node.
 *
 * نگاشت سلول‌های اکسل (Sheet1):
 *   A3 = B3 + C3                  قیمت شریک = قیمت مصوب + بودجه پاداش شریک
 *   C5 = C3 - B5                  حق تارگت شریک = بودجه پاداش شریک − حق ثبت شریک
 *   B8 = B3 ، C8 = C3 ، A8 = B8 + C8   (قیمت و بودجه نماینده؛ پیش‌فرض: لینک به شریک)
 *   B13 = B12 + C12 + D12         جمع پاداش نماینده
 *   E13 = E12 + F12 + G12         جمع پاداش شریک (از بودجهٔ نماینده)
 *   D14 = B13 + E13               جمع کل = باید با C8 برابر باشد
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.TT = root.TT || {}; root.TT.calc = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- کمکی‌های عددی ---------- */
  function toInt(v) { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; }
  function toMoney(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; }
  /** تنها مرجع «تعداد × نرخ» در کل برنامه */
  function reward(qty, rate) { return toInt(qty) * toMoney(rate); }

  /* ---------- قالب‌بندی (فارسی) ---------- */
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  function toFaDigits(s) { return String(s).replace(/[0-9]/g, d => FA[d]); }
  function fa(n) {
    const v = Math.round(Number(n) || 0);
    return toFaDigits(Math.abs(v).toLocaleString('en-US')) ;
  }
  /** عدد علامت‌دار با خط تیره برای منفی‌ها */
  function faSigned(n) { const v = Math.round(Number(n) || 0); return (v < 0 ? '-' : '') + fa(v); }
  /** تبدیل رقم فارسی/عربی به لاتین و استخراج عدد صحیح؛ ورودی خالی => null */
  function parseNumber(s) {
    if (s === null || s === undefined) return null;
    let t = String(s)
      .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
      .replace(/[,٬،\s]/g, '');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  /* ---------- مسیر در config ---------- */
  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setPath(obj, path, val) {
    const ks = path.split('.'); const last = ks.pop();
    const t = ks.reduce((o, k) => o[k], obj); t[last] = val;
  }

  /* ---------- مقادیر پیش‌فرض (از فایل اکسل) ---------- */
  function defaultConfig() {
    return {
      partner: {
        approvedPrice: 20000000,   // B3
        budget: 1000000,           // C3
        regRate: 500000,           // B5
        targetRateOverride: null   // C5 (پیش‌فرض: فرمول C3-B5)
      },
      agent: {
        approvedPriceOverride: null, // B8 (پیش‌فرض: =B3)
        budgetOverride: null,        // C8 (پیش‌فرض: =C3)
        regRate: 400000,             // B12
        targetRate: 200000,          // C12
        refAgentRate: 50000,         // D12
        refPartnerRate: 50000,       // E12
        oldRegPartnerRate: 150000,   // F12
        newRegPartnerRate: 150000    // G12
      }
    };
  }

  /* ---------- انواع پاداش (۸ نوع مطابق اکسل) ---------- */
  const REWARD_TYPES = [
    { code: 'P_REG',           label: 'حق ثبت شریک',                         cell: 'B5',  group: 'reg',      basket: 'partner', payee: 'partner' },
    { code: 'P_TARGET',        label: 'حق تارگت شریک',                       cell: 'C5',  group: 'target',   basket: 'partner', payee: 'partner' },
    { code: 'A_REG',           label: 'حق ثبت نماینده',                      cell: 'B12', group: 'reg',      basket: 'agent',   payee: 'agent' },
    { code: 'A_TARGET',        label: 'حق تارگت نماینده',                    cell: 'C12', group: 'target',   basket: 'agent',   payee: 'agent' },
    { code: 'REF_AGENT',       label: 'حق معرفی نماینده جدید به نماینده قدیم', cell: 'D12', group: 'referral', basket: 'agent',   payee: 'agent' },
    { code: 'REF_PARTNER',     label: 'حق معرفی نماینده توسط شریک',          cell: 'E12', group: 'referral', basket: 'agent',   payee: 'partner' },
    { code: 'OLD_REG_PARTNER', label: 'حق ثبت نماینده قدیم به شریک',         cell: 'F12', group: 'reg',      basket: 'agent',   payee: 'partner' },
    { code: 'NEW_REG_PARTNER', label: 'حق ثبت نماینده جدید به شریک',         cell: 'G12', group: 'reg',      basket: 'agent',   payee: 'partner' }
  ];
  const TYPE_BY_CODE = Object.fromEntries(REWARD_TYPES.map(t => [t.code, t]));

  /* ---------- نگاشت سلول‌های ورودی به config ---------- */
  const CELL_BINDINGS = {
    B3:  { path: 'partner.approvedPrice' },
    C3:  { path: 'partner.budget' },
    B5:  { path: 'partner.regRate' },
    C5:  { path: 'partner.targetRateOverride', override: true },
    B8:  { path: 'agent.approvedPriceOverride', override: true },
    C8:  { path: 'agent.budgetOverride', override: true },
    B12: { path: 'agent.regRate' },
    C12: { path: 'agent.targetRate' },
    D12: { path: 'agent.refAgentRate' },
    E12: { path: 'agent.refPartnerRate' },
    F12: { path: 'agent.oldRegPartnerRate' },
    G12: { path: 'agent.newRegPartnerRate' }
  };

  /** ارزیابی تمام سلول‌های جدول مادر (دقیقاً مثل فرمول‌های اکسل) */
  function evaluateCells(cfg) {
    const p = cfg.partner, a = cfg.agent;
    const v = {}, f = {}, over = {};
    v.B3 = toMoney(p.approvedPrice);                    f.B3 = null;
    v.C3 = toMoney(p.budget);                           f.C3 = null;
    v.A3 = v.B3 + v.C3;                                 f.A3 = '=B3+C3';
    v.B5 = toMoney(p.regRate);                          f.B5 = null;
    over.C5 = p.targetRateOverride !== null && p.targetRateOverride !== undefined;
    v.C5 = over.C5 ? toMoney(p.targetRateOverride) : v.C3 - v.B5;  f.C5 = '=C3-B5';
    over.B8 = a.approvedPriceOverride !== null && a.approvedPriceOverride !== undefined;
    v.B8 = over.B8 ? toMoney(a.approvedPriceOverride) : v.B3;      f.B8 = '=B3';
    over.C8 = a.budgetOverride !== null && a.budgetOverride !== undefined;
    v.C8 = over.C8 ? toMoney(a.budgetOverride) : v.C3;             f.C8 = '=C3';
    v.A8 = v.B8 + v.C8;                                 f.A8 = '=B8+C8';
    v.B12 = toMoney(a.regRate);
    v.C12 = toMoney(a.targetRate);
    v.D12 = toMoney(a.refAgentRate);
    v.E12 = toMoney(a.refPartnerRate);
    v.F12 = toMoney(a.oldRegPartnerRate);
    v.G12 = toMoney(a.newRegPartnerRate);
    v.B13 = v.B12 + v.C12 + v.D12;                      f.B13 = '=B12+C12+D12';
    v.E13 = v.E12 + v.F12 + v.G12;                      f.E13 = '=E12+F12+G12';
    v.D14 = v.B13 + v.E13;                              f.D14 = '=B13+E13';

    const rates = {};
    REWARD_TYPES.forEach(t => { rates[t.code] = v[t.cell]; });

    // کنترل طراحی: جمع نرخ‌های ۶ گانهٔ سبد نماینده باید با بودجهٔ هر دستگاه (C8) برابر باشد
    const diff = v.D14 - v.C8;
    const design = { ok: diff === 0, diff, total: v.D14, budget: v.C8 };
    return { values: v, formulas: f, overrides: over, rates, design };
  }

  return {
    toInt, toMoney, reward,
    fa, faSigned, toFaDigits, parseNumber,
    getPath, setPath,
    defaultConfig, REWARD_TYPES, TYPE_BY_CODE, CELL_BINDINGS,
    evaluateCells
  };
});
