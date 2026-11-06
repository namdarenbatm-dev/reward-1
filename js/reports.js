/*
 * reports.js — ساخت داده‌های گزارش (بدون DOM): جدول درآمد پلیر، گزارش توزیع، ماتریس ۸ نوع پاداش، خروجی CSV
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calculations'), require('./referrals'), require('./players'));
  else { root.TT = root.TT || {}; root.TT.reports = factory(root.TT.calc, root.TT.referrals, root.TT.players); }
})(typeof self !== 'undefined' ? self : this, function (calc, referrals, players) {
  'use strict';

  const ORD = ['اول', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم', 'هفتم', 'هشتم', 'نهم', 'دهم'];
  const ord = i => ORD[i] || String(i + 1) + 'ام';
  const typeLabel = p => players.TYPE_LABEL[p.type];
  const nameOf = (state, id) => { if (String(id).startsWith('ME-')) return 'ورودی دستی';  const p = players.getPlayer(state, id); return p ? p.name : '—'; };

  function formulaText(qty, rate, amount) {
    return `${calc.fa(qty)} × ${calc.fa(rate)} = ${calc.fa(amount)}`;
  }

  /** جدول درآمد مستقل هر پلیر (ساختار پیشنهادی بند ۵ دستور) */
  function playerIncome(state, result, playerId) {
    const p = players.getPlayer(state, playerId);
    if (!p) return null;
    const pp = result.perPlayer[playerId];
    const rates = result.rates;
    const rows = [];
    const line = (code) => pp.byCode[code];

    // ۱) حق ثبت و تارگت
    const regCode = p.type === 'partner' ? 'P_REG' : 'A_REG';
    const tgtCode = p.type === 'partner' ? 'P_TARGET' : 'A_TARGET';
    rows.push({ key: 'reg', kind: 'input', label: 'تعداد کارتخوان ثبت‌شده', qty: p.regDevices, rate: rates[regCode], amount: line(regCode).amount,
      rateLabel: calc.TYPE_BY_CODE[regCode].label, formula: formulaText(p.regDevices, rates[regCode], line(regCode).amount),
      bind: { type: 'player', field: 'regDevices', playerId } });
    rows.push({ key: 'target', kind: 'input', label: 'تعداد کارتخوان مشمول تارگت', qty: p.targetDevices, rate: rates[tgtCode], amount: line(tgtCode).amount,
      rateLabel: calc.TYPE_BY_CODE[tgtCode].label, formula: formulaText(p.targetDevices, rates[tgtCode], line(tgtCode).amount),
      bind: { type: 'player', field: 'targetDevices', playerId } });

    // ۲) درآمد شبکه (فقط شریک): حق ثبت نماینده قدیم/جدید
    if (p.type === 'partner') {
      ['OLD_REG_PARTNER', 'NEW_REG_PARTNER'].forEach(code => {
        const l = line(code);
        const src = l.entries.map(e => `${nameOf(state, e.sourceId)}: ${calc.fa(e.qty)} دستگاه`).join('، ');
        rows.push({ key: code, kind: 'calc', label: calc.TYPE_BY_CODE[code].label.replace('حق ثبت ', 'دستگاه‌های ثبت‌شده توسط '), qty: l.qty, rate: rates[code], amount: l.amount,
          rateLabel: calc.TYPE_BY_CODE[code].label, formula: formulaText(l.qty, rates[code], l.amount), note: src || 'شبکه‌ای ثبت نشده' });
      });
    }

    // ۳) معرفی‌ها
    const refCode = p.type === 'partner' ? 'REF_PARTNER' : 'REF_AGENT';
    const referred = referrals.referralsOf(state, p.id);
    rows.push({ key: 'refcount', kind: 'info', label: 'تعداد نمایندگان مستقیم معرفی‌شده', qty: referred.length + (state.manualEvents || []).filter(e => e.payeeId === p.id && e.kind === 'REF').reduce((a, e) => a + e.count, 0) });
    let refSum = 0;
    referred.forEach((a, i) => {
      const fp = referrals.getFirstPurchase(state, a.id);
      const st = referrals.referralStatus(state, a);
      const entry = line(refCode).entries.find(e => e.sourceId === a.id);
      const amount = entry ? entry.amount : 0;
      refSum += amount;
      rows.push({ key: 'ref-' + a.id, kind: 'input', label: `خرید اولیه نماینده ${ord(i)} — ${a.name}`, qty: fp ? fp.devices : 0, rate: rates[refCode], amount,
        rateLabel: calc.TYPE_BY_CODE[refCode].label,
        formula: st.eligible ? formulaText(fp.devices, rates[refCode], amount) : `شرایط ناقص (${st.missing.join('، ')}) → حق معرفی ایجاد نمی‌شود`,
        eventId: fp ? fp.id : null,
        bind: { type: 'fp', agentId: a.id } });
    });
    (state.manualEvents || []).filter(e => e.payeeId === p.id && e.kind === 'REF').forEach(e => {
      const entry = line(refCode).entries.find(x => x.sourceId === e.id);
      const amount = entry ? entry.amount : 0;
      rows.push({ key: 'me-' + e.id, kind: 'info', label: `رویداد دستی ${e.id} — ${calc.fa(e.count)} نماینده معرفی‌شده (دستگاه خرید اولیه)`, qty: e.devices, rate: rates[refCode], amount,
        rateLabel: calc.TYPE_BY_CODE[refCode].label, formula: formulaText(e.devices, rates[refCode], amount) });
    });
    rows.push({ key: 'refsum', kind: 'subtotal', label: 'مجموع حق معرفی', amount: pp.referral });
    rows.push({ key: 'total', kind: 'total', label: 'مجموع درآمد پلیر', amount: pp.total });
    return { player: p, rows, total: pp.total, share: pp.share, regAmount: pp.reg, targetAmount: pp.target, referralAmount: pp.referral };
  }

  /** گزارش نهایی توزیع پاداش — یک ردیف به ازای هر دریافت‌کننده */
  function distribution(state, result, opts) {
    const sort = (opts && opts.sort) || 'order';
    let rows = state.players.map(p => {
      const pp = result.perPlayer[p.id];
      return { id: p.id, name: p.name, type: p.type, typeLabel: typeLabel(p), reg: pp.reg, target: pp.target, referral: pp.referral, referralCount: pp.referralCount, referralPaidCount: pp.referralPaidCount, total: pp.total, share: pp.share };
    });
    if (sort === 'total') rows = rows.slice().sort((a, b) => b.total - a.total);
    return { rows, totals: Object.assign({}, result.grand, { referralCount: result.refStats.total, referralPaidCount: result.refStats.paid }), groups: result.groups };
  }

  /** ماتریس ۸ نوع پاداش به تفکیک پلیر (برای ممیزی) */
  function matrix(state, result) {
    const cols = calc.REWARD_TYPES;
    const rows = state.players.map(p => {
      const pp = result.perPlayer[p.id];
      const cells = cols.map(t => (pp.byCode[t.code] ? pp.byCode[t.code].amount : null));
      return { id: p.id, name: p.name, typeLabel: typeLabel(p), cells, total: pp.total };
    });
    const totals = cols.map(t => result.ledger.filter(e => e.code === t.code).reduce((s, e) => s + e.amount, 0));
    return { cols, rows, totals, grand: result.grand.total };
  }

  /* ---------- CSV ---------- */
  function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(rows) { return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }

  function playersCSV(state, result) {
    const head = ['شناسه', 'نام', 'نوع', 'شریک مربوطه', 'معرف مستقیم', 'دستگاه ثبت‌شده', 'دستگاه مشمول تارگت', 'شناسه خرید اولیه', 'دستگاه خرید اولیه',
      'تعداد معرفی مستقیم', 'حق ثبت (تومان)', 'حق تارگت (تومان)', 'حق معرفی (تومان)', 'جمع کل (تومان)'];
    const rows = [head];
    state.players.forEach(p => {
      const fp = p.type === 'agent' ? referrals.getFirstPurchase(state, p.id) : null;
      const pp = result.perPlayer[p.id];
      rows.push([p.id, p.name, typeLabel(p), p.partnerId ? nameOf(state, p.partnerId) : '', p.referrerId ? nameOf(state, p.referrerId) : '',
        p.regDevices, p.targetDevices, fp ? fp.id : '', fp ? fp.devices : '', referrals.referralsOf(state, p.id).length,
        pp.reg, pp.target, pp.referral, pp.total]);
    });
    return toCSV(rows);
  }

  function reportCSV(state, result) {
    const rows = [];
    rows.push(['گزارش توزیع پاداش — شبکه فروش توسن تکنو']);
    rows.push(['تاریخ تهیه', new Date().toISOString().slice(0, 10)]);
    rows.push([]);
    rows.push(['خلاصه بودجه (تومان)']);
    rows.push(['سبد', 'نرخ بودجه هر دستگاه', 'تعداد دستگاه', 'بودجه کل', 'تعهد محاسبه‌شده', 'مانده', 'کسری', 'وضعیت']);
    ['partner', 'agent'].forEach(k => {
      const b = result.baskets[k];
      rows.push([b.label, b.perDevice, b.devices, b.pool, b.committed, b.remaining, b.shortfall, b.status === 'short' ? 'کسری' : (b.status === 'empty' ? 'بدون داده' : 'کافی')]);
    });
    rows.push([]);
    rows.push(['گزارش توزیع به تفکیک دریافت‌کننده (تومان)']);
    rows.push(['دریافت‌کننده', 'نوع', 'تعداد معرفی مستقیم', 'معرفی‌های مستحق/پرداخت‌شده', 'حق ثبت', 'حق تارگت', 'حق معرفی', 'جمع کل', 'درصد سهم']);
    const d = distribution(state, result);
    d.rows.forEach(r => rows.push([r.name, r.typeLabel, r.referralCount, r.referralPaidCount, r.reg, r.target, r.referral, r.total, (r.share * 100).toFixed(2) + '%']));
    rows.push(['جمع کل', '', d.totals.referralCount, d.totals.referralPaidCount, d.totals.reg, d.totals.target, d.totals.referral, d.totals.total, d.totals.total ? '100.00%' : '0%']);
    rows.push([]);
    rows.push(['سهم گروه‌ها']);
    ['partner', 'agent'].forEach(k => {
      const g = result.groups[k];
      rows.push([k === 'partner' ? 'شریک‌ها' : 'نماینده‌ها', g.count, g.reg, g.target, g.referral, g.total, (g.share * 100).toFixed(2) + '%']);
    });
    rows.push([]);
    rows.push(['ماتریس ۸ نوع پاداش (تومان)']);
    const m = matrix(state, result);
    rows.push(['دریافت‌کننده', 'نوع'].concat(m.cols.map(c => c.label), ['جمع']));
    m.rows.forEach(r => rows.push([r.name, r.typeLabel].concat(r.cells.map(c => (c === null ? '' : c)), [r.total])));
    rows.push(['جمع', ''].concat(m.totals, [m.grand]));
    rows.push([]);
    rows.push(['کنترل‌های مالی']);
    result.controls.forEach(c => rows.push([c.title, c.ok ? 'PASS' : 'FAIL', c.detail]));
    return toCSV(rows);
  }

  return { ord, formulaText, playerIncome, distribution, matrix, playersCSV, reportCSV, toCSV, typeLabel };
});
