/*
 * reward-engine.js — موتور تولید و تخصیص پاداش (بدون DOM)
 *
 * خروجی compute(state):
 *  - ledger   : دفتر ریز پاداش‌ها (هر ردیف: نوع، گیرنده، سبد بودجه، تعداد، نرخ، مبلغ)
 *  - perPlayer: جمع پاداش هر پلیر به تفکیک ۸ نوع
 *  - baskets  : دو سبد بودجهٔ مستقل (شریک / نماینده) با مانده و کسری
 *  - groups   : سهم گروه‌های دریافت‌کننده (شریک‌ها / نماینده‌ها)
 *  - controls : کنترل‌های مالی (PASS/FAIL)
 *
 * تعریف سبد بودجه (طبق اکسل، بودجه «به‌ازای هر دستگاه» است):
 *   سبد شریک  = C3 × (مجموع دستگاه‌های ثبت‌شدهٔ شریک‌ها)   ← تأمین: حق ثبت/تارگت شریک
 *   سبد نماینده = C8 × (مجموع دستگاه‌های ثبت‌شدهٔ نماینده‌ها) ← تأمین: ۶ حق بخش نماینده/شریک در اکسل
 *   بودجهٔ هر سبد همیشه از جدول مادر محاسبه می‌شود (سقف دستی وجود ندارد).
 * مازاد یک سبد هرگز کسری سبد دیگر را پوشش نمی‌دهد.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calculations'), require('./referrals'), require('./players'));
  else { root.TT = root.TT || {}; root.TT.engine = factory(root.TT.calc, root.TT.referrals, root.TT.players); }
})(typeof self !== 'undefined' ? self : this, function (calc, referrals, players) {
  'use strict';

  const PARTNER_CODES = ['P_REG', 'P_TARGET', 'REF_PARTNER', 'OLD_REG_PARTNER', 'NEW_REG_PARTNER'];
  const AGENT_CODES = ['A_REG', 'A_TARGET', 'REF_AGENT'];
  const GROUPS = ['reg', 'target', 'referral'];

  /**
   * تفکیک دستگاه‌های ثبت‌شدهٔ یک نماینده به «جدید» و «قدیم».
   * فرض (قابل تغییر فقط در همین تابع): دستگاه‌های خرید اولیه = نماینده جدید؛ بقیه = نماینده قدیم.
   */
  function classifyAgentDevices(agent, firstPurchase) {
    const reg = calc.toInt(agent.regDevices);
    const fp = firstPurchase ? calc.toInt(firstPurchase.devices) : 0;
    const fresh = Math.min(fp, reg);
    return { fresh, old: reg - fresh };
  }

  function compute(state) {
    const cells = calc.evaluateCells(state.config);
    const rates = cells.rates;
    const P = state.players;
    const byId = Object.fromEntries(P.map(p => [p.id, p]));
    const ledger = [];

    const add = (code, payeeId, qty, sourceId) => {
      const t = calc.TYPE_BY_CODE[code];
      const q = calc.toInt(qty);
      if (q <= 0) return;
      ledger.push({
        id: `${code}|${payeeId}|${sourceId || 'self'}`,
        code, payeeId, basket: t.basket, group: t.group,
        sourceId: sourceId || null, qty: q, rate: rates[code], amount: calc.reward(q, rates[code])
      });
    };

    /* --- ۱) پاداش‌های عملکرد مستقیم --- */
    P.forEach(p => {
      if (p.type === 'partner') {
        add('P_REG', p.id, p.regDevices);
        add('P_TARGET', p.id, p.targetDevices);
      } else {
        add('A_REG', p.id, p.regDevices);
        add('A_TARGET', p.id, p.targetDevices);
        /* --- ۲) حق ثبت نماینده (قدیم/جدید) به شریک شبکه --- */
        const partner = p.partnerId ? byId[p.partnerId] : null;
        if (partner && partner.type === 'partner') {
          const split = classifyAgentDevices(p, referrals.getFirstPurchase(state, p.id));
          add('OLD_REG_PARTNER', partner.id, split.old, p.id);
          add('NEW_REG_PARTNER', partner.id, split.fresh, p.id);
        }
      }
    });

    /* --- ۳) حق معرفی: فقط معرف مستقیم، فقط یک‌بار برای خرید اولیه --- */
    referrals.referralSources(state).forEach(src => {
      const code = src.referrer.type === 'agent' ? 'REF_AGENT' : 'REF_PARTNER';
      add(code, src.referrer.id, src.devices, src.agent.id);
    });

    /* --- ۴) رویدادهای تجمیعی دستی: همان فرمول مشترک (دستگاه × نرخ)، همان دفتر ریز --- */
    const ME_CODE = { OLD_REG: 'OLD_REG_PARTNER', NEW_REG: 'NEW_REG_PARTNER' };
    (state.manualEvents || []).forEach(e => {
      const payee = byId[e.payeeId];
      if (!payee) return;
      const code = e.kind === 'REF' ? (payee.type === 'partner' ? 'REF_PARTNER' : 'REF_AGENT') : ME_CODE[e.kind];
      if (e.kind !== 'REF' && payee.type !== 'partner') return;
      add(code, payee.id, e.devices, e.id);
    });

    /* --- تجمیع به تفکیک پلیر --- */
    const perPlayer = {};
    P.forEach(p => {
      const codes = p.type === 'partner' ? PARTNER_CODES : AGENT_CODES;
      const byCode = {};
      codes.forEach(c => { byCode[c] = { code: c, qty: 0, rate: rates[c], amount: 0, entries: [] }; });
      perPlayer[p.id] = { player: p, byCode, referralCount: 0, referralPaidCount: 0, reg: 0, target: 0, referral: 0, total: 0, basket: { partner: 0, agent: 0 }, share: 0 };
    });
    ledger.forEach(e => {
      const pp = perPlayer[e.payeeId];
      if (!pp || !pp.byCode[e.code]) return;
      const line = pp.byCode[e.code];
      line.qty += e.qty; line.amount += e.amount; line.entries.push(e);
      pp[e.group] += e.amount; pp.total += e.amount; pp.basket[e.basket] += e.amount;
    });

    /* --- شمارندهٔ معرفی‌ها: کل معرفی‌های مستقیم / معرفی‌های مستحقِ پرداخت‌شده --- */
    const refStats = { total: 0, paid: 0, pending: 0 };
    P.forEach(p => {
      const pp = perPlayer[p.id];
      const manualRef = (state.manualEvents || []).filter(e => e.payeeId === p.id && e.kind === 'REF');
      const manualCnt = manualRef.reduce((s, e) => s + e.count, 0);
      pp.referralCount = referrals.referralsOf(state, p.id).length + manualCnt;
      const code = p.type === 'partner' ? 'REF_PARTNER' : 'REF_AGENT';
      const linkedPaid = pp.byCode[code] ? pp.byCode[code].entries.filter(e => !String(e.sourceId).startsWith('ME-')).length : 0;
      pp.referralPaidCount = linkedPaid + manualRef.reduce((s, e) => s + Math.min(e.count, e.devices), 0);
      refStats.total += pp.referralCount; refStats.paid += pp.referralPaidCount;
    });
    refStats.pending = refStats.total - refStats.paid;

    /* --- جمع‌های کل و گروه‌های دریافت‌کننده --- */
    const grand = { reg: 0, target: 0, referral: 0, total: 0 };
    const groups = {
      partner: { reg: 0, target: 0, referral: 0, total: 0, count: 0, share: 0 },
      agent:   { reg: 0, target: 0, referral: 0, total: 0, count: 0, share: 0 }
    };
    P.forEach(p => {
      const pp = perPlayer[p.id];
      GROUPS.forEach(g => { grand[g] += pp[g]; groups[p.type][g] += pp[g]; });
      grand.total += pp.total; groups[p.type].total += pp.total; groups[p.type].count += 1;
    });
    P.forEach(p => { perPlayer[p.id].share = grand.total > 0 ? perPlayer[p.id].total / grand.total : 0; });
    groups.partner.share = grand.total > 0 ? groups.partner.total / grand.total : 0;
    groups.agent.share = grand.total > 0 ? groups.agent.total / grand.total : 0;

    /* --- دو سبد بودجهٔ مستقل --- */
    const mkBasket = (key, label, perDevice, devices) => {
      const derived = perDevice * devices;
      const pool = derived;
      const committed = ledger.filter(e => e.basket === key).reduce((s, e) => s + e.amount, 0);
      const remaining = pool - committed;
      return {
        key, label, perDevice, devices, derived, pool, committed,
        remaining, shortfall: remaining < 0 ? -remaining : 0,
        status: pool === 0 && committed === 0 ? 'empty' : (remaining < 0 ? 'short' : 'ok')
      };
    };
    const partnerDevices = players.partners(state).reduce((s, p) => s + calc.toInt(p.regDevices), 0);
    // دستگاه‌های ثبت‌شدهٔ رویدادهای دستی (قدیم/جدید) که در جدول پلیرها نیستند، به مبنای بودجهٔ نماینده اضافه می‌شوند
    const manualRegDevices = (state.manualEvents || []).filter(e => e.kind !== 'REF').reduce((s, e) => s + calc.toInt(e.devices), 0);
    const agentDevices = players.agents(state).reduce((s, p) => s + calc.toInt(p.regDevices), 0) + manualRegDevices;
    const baskets = {
      partner: mkBasket('partner', 'بودجه پاداش شریک از محل افزایش قیمت دستگاه', cells.values.C3, partnerDevices),
      agent: mkBasket('agent', 'بودجه پاداش نماینده و پاداش شریک از فعالیت نماینده از محل افزایش قیمت دستگاه', cells.values.C8, agentDevices)
    };

    /* --- کنترل‌های مالی --- */
    const ledgerSum = ledger.reduce((s, e) => s + e.amount, 0);
    const playersSum = P.reduce((s, p) => s + perPlayer[p.id].total, 0);
    const basketsSum = baskets.partner.committed + baskets.agent.committed;
    const groupsSum = groups.partner.total + groups.agent.total;
    const reconOk = ledgerSum === playersSum && playersSum === basketsSum && basketsSum === groupsSum && groupsSum === grand.total;

    const refEntries = ledger.filter(e => e.code === 'REF_AGENT' || e.code === 'REF_PARTNER');
    const refKeys = new Set(refEntries.map(e => e.sourceId));
    const fpAgents = (state.firstPurchases || []).map(e => e.agentId);
    const dupFp = fpAgents.length !== new Set(fpAgents).size;
    const dataIssues = players.validate(state);
    const errors = dataIssues.filter(i => i.level === 'error');

    const controls = [
      { id: 'recon', ok: reconOk, title: 'تطبیق جمع سهم‌ها با تعهدات',
        detail: reconOk ? 'جمع پلیرها = دفتر ریز = جمع سبدها = جمع گروه‌ها.' : `ناهمخوانی: دفتر ${ledgerSum} / پلیرها ${playersSum} / سبدها ${basketsSum} / گروه‌ها ${groupsSum}` },
      { id: 'budget-partner', ok: baskets.partner.status !== 'short', title: 'کفایت بودجه شریک',
        detail: baskets.partner.status === 'short' ? `کسری ${baskets.partner.shortfall}` : 'مانده نامنفی است.' },
      { id: 'budget-agent', ok: baskets.agent.status !== 'short', title: 'کفایت بودجه نماینده',
        detail: baskets.agent.status === 'short' ? `کسری ${baskets.agent.shortfall}` : 'مانده نامنفی است.' },
      { id: 'ref-once', ok: refEntries.length === refKeys.size, title: 'حق معرفی فقط یک‌بار برای هر خرید اولیه',
        detail: `${refEntries.length} پرداخت معرفی برای ${refKeys.size} خرید اولیهٔ مجزا.` },
      { id: 'fp-dup', ok: !dupFp, title: 'نبود ثبت تکراری خرید اولیه',
        detail: dupFp ? 'برای یک نماینده بیش از یک خرید اولیه وجود دارد.' : 'هر نماینده حداکثر یک رویداد خرید اولیه دارد.' },
      { id: 'design', ok: cells.design.ok, title: 'جمع نرخ‌های ششگانهٔ جدول مادر برابر بودجهٔ هر دستگاه نماینده',
        detail: cells.design.ok ? 'جمع نرخ‌ها با بودجهٔ هر دستگاه برابر است.' : `اختلاف ${cells.design.diff} تومان (جمع نرخ‌ها ${cells.design.total} در برابر بودجه ${cells.design.budget})` },
      { id: 'data', ok: errors.length === 0, title: 'اعتبار ورودی‌ها',
        detail: errors.length ? errors[0].msg : 'خطای منطقی در ورودی‌ها دیده نشد.' }
    ];

    return {
      cells, rates, ledger, perPlayer, order: P.map(p => p.id),
      grand, groups, baskets, refStats, controls, issues: dataIssues,
      referralTotal: grand.referral,
      allOk: controls.every(c => c.ok)
    };
  }

  return { compute, classifyAgentDevices, PARTNER_CODES, AGENT_CODES, GROUPS };
});
