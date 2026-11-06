/*
 * calculation-tests.js — آزمون‌های محاسباتی (۹ سناریوی دستور + تطبیق با اکسل)
 * اجرا در Node:   node tests/calculation-tests.js
 * اجرا در مرورگر: دکمهٔ «اجرای آزمون‌ها» در تب «داده و پشتیبان»
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const m = factory({
      calc: require('../js/calculations'), referrals: require('../js/referrals'), players: require('../js/players'),
      engine: require('../js/reward-engine'), reports: require('../js/reports'), storage: require('../js/storage')
    }, true);
    module.exports = m;
    if (require.main === module) {
      const res = m.runAll();
      res.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '\n      → ' + r.error}`));
      const failed = res.filter(r => !r.pass).length;
      console.log(`\n${res.length - failed}/${res.length} PASS` + (failed ? `  —  ${failed} FAIL` : ''));
      process.exit(failed ? 1 : 0);
    }
  } else {
    root.TT = root.TT || {};
    root.TT.tests = factory({ calc: root.TT.calc, referrals: root.TT.referrals, players: root.TT.players, engine: root.TT.engine, reports: root.TT.reports, storage: root.TT.storage }, false);
  }
})(typeof self !== 'undefined' ? self : this, function (M, isNode) {
  'use strict';
  const { calc, referrals, players, engine, reports, storage } = M;
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  function eq(actual, expected, msg) {
    if (actual !== expected) throw new Error(`${msg || 'مقدار نامطابق'}: انتظار ${expected} ولی ${actual}`);
  }
  function truthy(v, msg) { if (!v) throw new Error(msg || 'شرط برقرار نیست'); }

  /* ساخت state تمیز با پلیرهای مشخص */
  function fresh() { return players.newState(); }
  const mkPartner = (s, name, reg, tgt) => players.addPlayer(s, { name, type: 'partner', regDevices: reg || 0, targetDevices: tgt || 0 }).player;
  const mkAgent = (s, name, partnerId, reg, tgt) => players.addPlayer(s, { name, type: 'agent', partnerId, regDevices: reg || 0, targetDevices: tgt || 0 }).player;
  /* ثبت‌نام تکمیل + مدارک تأیید (دو شرط از سه شرط حق معرفی) */
  const qualify = a => { a.registrationCompleted = true; a.docsApproved = true; return a; };
  const refLines = (s, code) => engine.compute(s).ledger.filter(e => e.code === code);
  const total = (s, id) => engine.compute(s).perPlayer[id].total;
  const line = (s, id, code) => engine.compute(s).perPlayer[id].byCode[code];

  /* ========== تطبیق با فایل اکسل (مقادیر پیش‌فرض و فرمول‌ها) ========== */
  test('اکسل: مقادیر محاسبه‌شدهٔ سلول‌ها با مقادیر ذخیره‌شدهٔ فایل یکی است', () => {
    const v = calc.evaluateCells(calc.defaultConfig()).values;
    eq(v.A3, 21000000, 'A3'); eq(v.C5, 500000, 'C5'); eq(v.A8, 21000000, 'A8');
    eq(v.B8, 20000000, 'B8'); eq(v.C8, 1000000, 'C8');
    eq(v.B13, 650000, 'B13'); eq(v.E13, 350000, 'E13'); eq(v.D14, 1000000, 'D14');
  });
  test('اکسل: D14 با C8 برابر است (کنترل طراحی) و با تغییر نرخ، اختلاف دقیق نشان داده می‌شود', () => {
    const cfg = calc.defaultConfig();
    eq(calc.evaluateCells(cfg).design.ok, true, 'پیش‌فرض');
    cfg.agent.refAgentRate = 60000;
    const d = calc.evaluateCells(cfg).design;
    eq(d.ok, false, 'ok'); eq(d.diff, 10000, 'diff');
  });
  test('اکسل: C5 = C3 − B5 و با تغییر B5 به‌روز می‌شود؛ override جایگزین فرمول می‌شود', () => {
    const cfg = calc.defaultConfig();
    cfg.partner.regRate = 300000;
    eq(calc.evaluateCells(cfg).values.C5, 700000, 'C5 فرمولی');
    cfg.partner.targetRateOverride = 450000;
    eq(calc.evaluateCells(cfg).values.C5, 450000, 'C5 override');
  });

  /* ========== رگرسیون: حق ثبت / تارگت (بدون تغییر) ========== */
  test('رگرسیون — حق ثبت = تعداد دستگاه ثبت‌شده × نرخ (شریک و نماینده)', () => {
    const s = fresh();
    const p = mkPartner(s, 'ش', 7, 0); const a = mkAgent(s, 'ن', p.id, 10, 0);
    eq(line(s, p.id, 'P_REG').amount, 7 * 500000, 'حق ثبت شریک');
    eq(line(s, a.id, 'A_REG').amount, 10 * 400000, 'حق ثبت نماینده');
  });
  test('رگرسیون — حق تارگت = تعداد مشمول تارگت × نرخ (شریک: C3−B5 ؛ نماینده: C12)', () => {
    const s = fresh();
    const p = mkPartner(s, 'ش', 9, 4); const a = mkAgent(s, 'ن', p.id, 10, 6);
    eq(line(s, p.id, 'P_TARGET').amount, 4 * 500000, 'تارگت شریک');
    eq(line(s, a.id, 'A_TARGET').amount, 6 * 200000, 'تارگت نماینده');
  });

  /* ========== ۱۱ تست الزامی درخواست تغییر ========== */
  test('تست ۱ — یک نماینده ۳، ۵ و ۱۲ نماینده معرفی می‌کند: هیچ سقفی وجود ندارد', () => {
    const s = fresh(); const p = mkPartner(s, 'ش', 0, 0);
    const A = mkAgent(s, 'الف', p.id);
    for (let i = 1; i <= 12; i++) {
      const x = mkAgent(s, 'نماینده ' + i, p.id);
      const r = referrals.setReferrer(s, x.id, A.id);
      eq(r.ok, true, 'معرفی شمارهٔ ' + i);
    }
    eq(referrals.referralsOf(s, A.id).length, 12, 'تعداد معرفی‌ها');
    const viaAdd = players.addPlayer(s, { name: 'سیزدهم', type: 'agent', partnerId: p.id, referrerId: A.id });
    eq(viaAdd.ok, true, 'addPlayer هم بدون سقف'); eq(referrals.referralsOf(s, A.id).length, 13, 'پس از افزودن');
    eq(engine.compute(s).controls.some(c => c.id === 'ref-cap'), false, 'کنترل سقف در موتور حذف شده');
    eq('rules' in s.config, false, 'تنظیمات سقف در config وجود ندارد');
  });

  test('تست ۲ — فقط ثبت‌نام تکمیل شده (بدون مدارک و بدون خرید): حق معرفی صفر', () => {
    const s = fresh(); const p = mkPartner(s, 'ش', 0, 0);
    const A = mkAgent(s, 'الف', p.id); const B = mkAgent(s, 'ب', p.id, 0, 0);
    referrals.setReferrer(s, B.id, A.id); players.updatePlayer(s, B.id, { registrationCompleted: true });
    eq(refLines(s, 'REF_AGENT').length, 0, 'ردیف معرفی'); eq(total(s, A.id), 0, 'مجموع الف');
  });

  test('تست ۳ — مدارک تأیید شده ولی خریدی نشده: حق معرفی صفر', () => {
    const s = fresh(); const p = mkPartner(s, 'ش', 0, 0);
    const A = mkAgent(s, 'الف', p.id); const B = mkAgent(s, 'ب', p.id);
    referrals.setReferrer(s, B.id, A.id); qualify(B);
    eq(refLines(s, 'REF_AGENT').length, 0, 'ردیف معرفی'); eq(total(s, A.id), 0, 'مجموع الف');
    // مورد مکمل: خرید اولیه شده ولی مدارک تأیید نشده → باز هم صفر
    const C = mkAgent(s, 'ج', p.id, 5); referrals.setReferrer(s, C.id, A.id);
    players.updatePlayer(s, C.id, { registrationCompleted: true, docsApproved: false });
    referrals.registerFirstPurchase(s, C.id, 5);
    eq(refLines(s, 'REF_AGENT').length, 0, 'خرید بدون تأیید مدارک');
    // مورد مکمل: خرید شده ولی ثبت‌نام تکمیل نشده → صفر
    const D = mkAgent(s, 'د', p.id, 5); referrals.setReferrer(s, D.id, A.id);
    players.updatePlayer(s, D.id, { registrationCompleted: false, docsApproved: true });
    referrals.registerFirstPurchase(s, D.id, 5);
    eq(refLines(s, 'REF_AGENT').length, 0, 'خرید بدون تکمیل ثبت‌نام');
  });

  test('تست ۴ — ثبت‌نام + تأیید مدارک + خرید اولیه: دقیقاً یک حق معرفی ایجاد می‌شود', () => {
    const s = fresh(); const p = mkPartner(s, 'ش', 0, 0);
    const A = mkAgent(s, 'الف', p.id); const B = mkAgent(s, 'ب', p.id, 20);
    referrals.setReferrer(s, B.id, A.id); qualify(B); referrals.registerFirstPurchase(s, B.id, 20);
    const lines = refLines(s, 'REF_AGENT');
    eq(lines.length, 1, 'تعداد رویداد'); eq(lines[0].payeeId, A.id, 'گیرنده'); eq(lines[0].sourceId, B.id, 'منبع');
  });

  test('تست ۵ — مبلغ = N × نرخ حق معرفی برای N های مختلف (۱، ۷، ۲۰، ۳۳)', () => {
    [1, 7, 20, 33].forEach(n => {
      const s = fresh(); const p = mkPartner(s, 'ش', 0, 0);
      const A = mkAgent(s, 'الف', p.id); const B = mkAgent(s, 'ب', p.id, n);
      referrals.setReferrer(s, B.id, A.id); qualify(B); referrals.registerFirstPurchase(s, B.id, n);
      eq(line(s, A.id, 'REF_AGENT').amount, n * 50000, 'N=' + n);
      eq(line(s, A.id, 'REF_AGENT').qty, n, 'مبنای تعداد');
    });
    // نرخ از جدول مادر (D12) خوانده می‌شود، نه عدد ثابت
    const s = fresh(); s.config.agent.refAgentRate = 70000;
    const p = mkPartner(s, 'ش', 0, 0); const A = mkAgent(s, 'الف', p.id); const B = mkAgent(s, 'ب', p.id, 10);
    referrals.setReferrer(s, B.id, A.id); qualify(B); referrals.registerFirstPurchase(s, B.id, 10);
    eq(line(s, A.id, 'REF_AGENT').amount, 700000, 'نرخ تغییر‌یافتهٔ D12');
  });

  test('تست ۶ — خریدهای بعدی (۳۰ دستگاه دیگر) حق معرفی اضافه نمی‌سازد', () => {
    const s = fresh(); const p = mkPartner(s, 'ش', 0, 0);
    const A = mkAgent(s, 'الف', p.id); const B = mkAgent(s, 'ب', p.id, 20);
    referrals.setReferrer(s, B.id, A.id); qualify(B); referrals.registerFirstPurchase(s, B.id, 20);
    eq(line(s, A.id, 'REF_AGENT').amount, 20 * 50000, 'پس از خرید اولیه');
    players.updatePlayer(s, B.id, { regDevices: 50 });                       // ۳۰ دستگاه خرید بعدی
    eq(line(s, A.id, 'REF_AGENT').amount, 20 * 50000, 'پس از خرید بعدی');
    eq(refLines(s, 'REF_AGENT').length, 1, 'هنوز یک رویداد');
    eq(line(s, B.id, 'A_REG').amount, 50 * 400000, 'حق ثبت شخصی ب با ۵۰ دستگاه (مستقل از معرفی)');
  });

  test('تست ۷ — فقط معرف مستقیم پاداش می‌گیرد: الف→ب→ج (الف برای ج هیچ‌چیز نمی‌گیرد)', () => {
    const s = fresh(); const p = mkPartner(s, 'ش', 0, 0);
    const A = mkAgent(s, 'الف', p.id, 0); const B = mkAgent(s, 'ب', p.id, 20); const C = mkAgent(s, 'ج', p.id, 10);
    referrals.setReferrer(s, B.id, A.id); referrals.setReferrer(s, C.id, B.id);
    qualify(B); qualify(C); referrals.registerFirstPurchase(s, B.id, 20); referrals.registerFirstPurchase(s, C.id, 10);
    eq(line(s, A.id, 'REF_AGENT').amount, 20 * 50000, 'الف فقط بابت ب');
    eq(line(s, B.id, 'REF_AGENT').amount, 10 * 50000, 'ب بابت ج');
    const forC = engine.compute(s).ledger.filter(e => e.sourceId === C.id && (e.code === 'REF_AGENT' || e.code === 'REF_PARTNER'));
    eq(forC.length, 1, 'یک پرداخت معرفی برای ج'); eq(forC[0].payeeId, B.id, 'فقط ب');
    eq(A.referrerId, null, 'الف معرف دارد؟'); // الف معرف بالادستی نیست؛ زنجیره ایجاد نمی‌شود
    // معرف شریک: فقط شریکِ معرف مستقیم E12 می‌گیرد
    const s2 = fresh(); const P = mkPartner(s2, 'شریک', 0, 0); const A2 = mkAgent(s2, 'الف', P.id, 8);
    referrals.setReferrer(s2, A2.id, P.id); qualify(A2); referrals.registerFirstPurchase(s2, A2.id, 8);
    eq(line(s2, P.id, 'REF_PARTNER').amount, 8 * 50000, 'شریک معرف مستقیم');
  });

  test('تست ۸ — به معرف مستقیم هیچ «حق ثبت»ی بابت دستگاه‌های نمایندهٔ معرفی‌شده تعلق نمی‌گیرد', () => {
    const s = fresh(); const p = mkPartner(s, 'ش', 0, 0);
    const A = mkAgent(s, 'الف', p.id, 5, 2); const B = mkAgent(s, 'ب', p.id, 20, 10);
    referrals.setReferrer(s, B.id, A.id); qualify(B); referrals.registerFirstPurchase(s, B.id, 20);
    const r = engine.compute(s);
    const toA = r.ledger.filter(e => e.payeeId === A.id);
    toA.forEach(e => { if (e.sourceId === B.id) eq(e.group, 'referral', 'هر پرداخت الف از منبع ب باید «معرفی» باشد، نه ' + e.code); });
    eq(toA.filter(e => e.sourceId === B.id && e.group === 'reg').length, 0, 'حق ثبت بابت ب');
    eq(Object.keys(r.perPlayer[A.id].byCode).sort().join(','), 'A_REG,A_TARGET,REF_AGENT', 'الف فقط ۳ نوع پاداش دارد');
    eq(r.perPlayer[A.id].total, 5 * 400000 + 2 * 200000 + 20 * 50000, 'جمع الف = شخصی + معرفی');
    // تغییر دستگاه‌های ب، حق ثبت الف را تغییر نمی‌دهد
    players.updatePlayer(s, B.id, { regDevices: 99 });
    eq(line(s, A.id, 'A_REG').amount, 5 * 400000, 'حق ثبت الف ثابت');
  });

  test('تست ۹ — حق ثبت شخصی نمایندهٔ جدید مطابق مدل موجود است و به معرفی‌شدن بستگی ندارد', () => {
    const mk = introduced => {
      const s = fresh(); const p = mkPartner(s, 'ش', 0, 0); const A = mkAgent(s, 'الف', p.id); const B = mkAgent(s, 'ب', p.id, 20, 8);
      if (introduced) { referrals.setReferrer(s, B.id, A.id); qualify(B); referrals.registerFirstPurchase(s, B.id, 20); }
      return { s, B, p };
    };
    const x = mk(true), y = mk(false);
    eq(line(x.s, x.B.id, 'A_REG').amount, 20 * 400000, 'حق ثبت ب (معرفی‌شده)');
    eq(line(x.s, x.B.id, 'A_TARGET').amount, 8 * 200000, 'حق تارگت ب');
    eq(line(x.s, x.B.id, 'A_REG').amount, line(y.s, y.B.id, 'A_REG').amount, 'بدون تفاوت با حالت معرفی‌نشده');
    eq(total(x.s, x.B.id), total(y.s, y.B.id), 'مجموع شخصی ب یکسان');
    // F12/G12 شریک شبکه (مطابق اکسل) دست‌نخورده است
    eq(line(x.s, x.p.id, 'NEW_REG_PARTNER').amount, 20 * 150000, 'G12 شریک');
  });

  test('تست ۱۰ — پردازش مکرر همان خرید اولیه (ثبت دوباره، ویرایش، به‌روزرسانی، ذخیره/بازیابی) پاداش تکراری نمی‌سازد', () => {
    const s = fresh(); const p = mkPartner(s, 'ش', 0, 0);
    const A = mkAgent(s, 'الف', p.id); const B = mkAgent(s, 'ب', p.id, 20);
    referrals.setReferrer(s, B.id, A.id); qualify(B);
    const first = referrals.registerFirstPurchase(s, B.id, 20);
    for (let i = 0; i < 5; i++) {
      eq(referrals.registerFirstPurchase(s, B.id, 20).ok, false, 'ثبت مجدد باید رد شود');
      referrals.updateFirstPurchase(s, first.event.id, 20);          // به‌روزرسانی مکرر با همان مقدار
      referrals.setReferrer(s, B.id, A.id);                          // تعیین دوباره معرف
      players.updatePlayer(s, B.id, { registrationCompleted: true, docsApproved: true });
      eq(refLines(s, 'REF_AGENT').length, 1, 'تعداد رویداد در دور ' + i);
      eq(line(s, A.id, 'REF_AGENT').amount, 20 * 50000, 'مبلغ در دور ' + i);
    }
    eq(s.firstPurchases.length, 1, 'رویداد ذخیره‌شده');
    // بازیابی‌های پشت‌سرهم از پشتیبان (شبیه refresh/بارگذاری مجدد)
    let cur = s;
    for (let i = 0; i < 3; i++) cur = storage.parseBackup(storage.buildBackup(cur)).state;
    eq(refLines(cur, 'REF_AGENT').length, 1, 'پس از ۳ بار بازیابی'); eq(line(cur, A.id, 'REF_AGENT').amount, 1000000, 'مبلغ پس از بازیابی');
    // داده‌ی دارای دو رویداد برای یک نماینده (خراب) هنگام نرمال‌سازی یکی می‌شود
    const raw = JSON.parse(JSON.stringify(s)); raw.firstPurchases.push({ id: 'FP-0099', agentId: B.id, devices: 20 });
    const n = players.normalizeState(raw);
    eq(engine.compute(n).ledger.filter(e => e.code === 'REF_AGENT').length, 1, 'نرمال‌سازی داده تکراری');
  });

  test('تست ۱۱ — بودجه‌ها و مانده‌ها: بدون شمارش مضاعف؛ افزودن خرید اولیه دقیقاً به‌اندازهٔ حق معرفی جمع کل را تغییر می‌دهد', () => {
    const s = players.sampleState(); const r0 = engine.compute(s);
    eq(r0.controls.find(c => c.id === 'recon').ok, true, 'تطبیق');
    eq(r0.grand.total, r0.ledger.reduce((a, e) => a + e.amount, 0), 'جمع = دفتر ریز');
    eq(r0.baskets.partner.committed + r0.baskets.agent.committed, r0.grand.total, 'جمع سبدها');
    eq(r0.referralTotal, r0.ledger.filter(e => e.group === 'referral').reduce((a, e) => a + e.amount, 0), 'جمع معرفی');
    // نماینده جدید با خرید اولیه ۱۵ دستگاه (توسط ب معرفی می‌شود)
    const B = s.players.find(x => x.name === 'نماینده ب');
    const D = players.addPlayer(s, { name: 'نماینده د', type: 'agent', partnerId: s.players[0].id, regDevices: 15 }).player;
    referrals.setReferrer(s, D.id, B.id); qualify(D);
    const r1 = engine.compute(s);   // هنوز خرید اولیه ندارد: فقط حق ثبت شخصی
    // قبل از خرید اولیه: حق ثبت شخصی د (۱۵×۴۰۰k) + حق ثبت شبکه به شریک (F12 برای ۱۵ دستگاه، طبق اکسل) و هیچ حق معرفی
    eq(r1.grand.total - r0.grand.total, 15 * 400000 + 15 * 150000, 'قبل از خرید اولیه');
    eq(r1.referralTotal, r0.referralTotal, 'حق معرفی تغییر نکرده');
    referrals.registerFirstPurchase(s, D.id, 15);
    const r2 = engine.compute(s);
    // افزودهٔ خرید اولیه فقط حق معرفی ب (۱۵×۵۰k) است؛ F12 و G12 هم‌نرخ‌اند و جابه‌جایی «قدیم→جدید» مبلغی تغییر نمی‌دهد
    eq(r2.grand.total - r1.grand.total, 15 * 50000, 'افزایش جمع کل');
    eq(r2.referralTotal - r1.referralTotal, 15 * 50000, 'افزایش حق معرفی');
    eq(r2.controls.find(c => c.id === 'recon').ok, true, 'تطبیق پس از افزودن');
    eq(r2.allOk, true, 'همهٔ کنترل‌ها');
  });

  test('رویداد تجمیعی دستی — معرفی/ثبت شبکه با همان فرمول دستگاه × نرخ، بدون دوبارشماری و با تطبیق کامل', () => {
    const s = fresh();
    const p = mkPartner(s, 'ش', 0, 0);
    const a = mkAgent(s, 'ن', null, 10, 5);
    const base = engine.compute(s);
    // شریک: ۵ نماینده معرفی‌شده با ۴۰ دستگاه خرید اولیه → ۴۰ × ۵۰٬۰۰۰
    eq(players.addManualEvent(s, { payeeId: p.id, kind: 'REF', count: 5, devices: 40 }).ok, true, 'افزودن معرفی شریک');
    // نمایندهٔ قدیم: ۳ نمایندهٔ جدید با ۱۲ دستگاه → ۱۲ × ۵۰٬۰۰۰
    const e2 = players.addManualEvent(s, { payeeId: a.id, kind: 'REF', count: 3, devices: 12 });
    // حق ثبت قدیم/جدید به شریک
    players.addManualEvent(s, { payeeId: p.id, kind: 'OLD_REG', count: 2, devices: 7 });
    players.addManualEvent(s, { payeeId: p.id, kind: 'NEW_REG', count: 4, devices: 9 });
    eq(players.addManualEvent(s, { payeeId: a.id, kind: 'OLD_REG', count: 1, devices: 1 }).ok, false, 'ثبت قدیم برای نماینده مجاز نیست');
    const r = engine.compute(s);
    eq(r.perPlayer[p.id].byCode.REF_PARTNER.amount, 40 * 50000, 'E12');
    eq(r.perPlayer[a.id].byCode.REF_AGENT.amount, 12 * 50000, 'D12');
    eq(r.perPlayer[p.id].byCode.OLD_REG_PARTNER.amount, 7 * 150000, 'F12');
    eq(r.perPlayer[p.id].byCode.NEW_REG_PARTNER.amount, 9 * 150000, 'G12');
    eq(r.grand.total - base.grand.total, (40 + 12) * 50000 + (7 + 9) * 150000, 'افزایش جمع کل');
    eq(r.perPlayer[p.id].referralCount, 5, 'شمارندهٔ معرفی شریک'); eq(r.perPlayer[a.id].referralCount, 3, 'شمارندهٔ معرفی نماینده');
    eq(r.controls.find(c => c.id === 'recon').ok, true, 'تطبیق'); eq(r.controls.find(c => c.id === 'ref-once').ok, true, 'ref-once');
    // حق معرفی فقط برای نمایندهٔ دارای ≥۱ دستگاه: ۵ نماینده با ۳ دستگاه → فقط ۳ مستحق، ولی مبلغ همچنان دستگاه × نرخ
    const e3 = players.addManualEvent(s, { payeeId: p.id, kind: 'REF', count: 5, devices: 3 });
    const r3 = engine.compute(s);
    eq(r3.perPlayer[p.id].referralPaidCount, 5 + 3, 'مستحق = min(تعداد، دستگاه)');
    truthy(players.validate(s).some(i => i.code === 'ME_DEV_LT_COUNT'), 'هشدار برای معرفی');
    players.removeManualEvent(s, e3.event.id);
    // ثبت قدیم/جدید: هشدار حداقل-دستگاه ندارد
    const e4 = players.addManualEvent(s, { payeeId: p.id, kind: 'NEW_REG', count: 5, devices: 2 });
    eq(players.validate(s).some(i => i.code === 'ME_DEV_LT_COUNT'), false, 'بدون هشدار برای ثبت جدید');
    players.removeManualEvent(s, e4.event.id);
    // ویرایش و حذف
    players.updateManualEvent(s, e2.event.id, { devices: 20 });
    eq(engine.compute(s).perPlayer[a.id].byCode.REF_AGENT.amount, 20 * 50000, 'ویرایش');
    players.removeManualEvent(s, e2.event.id);
    eq(engine.compute(s).perPlayer[a.id].byCode.REF_AGENT.amount, 0, 'حذف');
    // ماندگاری و حذف پلیر
    const n = players.normalizeState(JSON.parse(JSON.stringify(s)));
    eq(n.manualEvents.length, 3, 'نرمال‌سازی');
    players.removePlayer(s, p.id); eq(s.manualEvents.length, 0, 'حذف پلیر رویدادهایش را پاک می‌کند');
  });

  test('بودجه — کسری دقیق نمایش داده شود و مازاد یک سبد کسری سبد دیگر را نمی‌پوشاند', () => {
    const s = fresh();
    const p = mkPartner(s, 'ش', 10, 4);
    const a = mkAgent(s, 'ن', p.id, 5, 5);
    s.config.agent.budgetOverride = 100000;   // بودجهٔ هر دستگاه نماینده کم می‌شود (سقف دستی وجود ندارد)
    const r = engine.compute(s);
    const expected = 5 * 400000 + 5 * 200000 + 5 * 150000;
    eq(r.baskets.agent.committed, expected, 'تعهد سبد نماینده');
    eq(r.baskets.agent.shortfall, expected - 100000 * 5, 'کسری دقیق');
    eq(r.baskets.agent.status, 'short', 'وضعیت'); eq(r.baskets.partner.status, 'ok', 'سبد شریک مستقل است');
    truthy(r.baskets.partner.remaining > 0, 'مانده شریک مثبت است ولی کسری نماینده را نمی‌پوشاند');
    eq(r.controls.find(c => c.id === 'budget-agent').ok, false, 'FAIL'); eq(r.allOk, false, 'وضعیت کلی');
    void a;
  });

  test('مهاجرت غیرمخرب — داده‌ی قدیمی بدون فیلدهای ثبت‌نام/مدارک: مبالغ قبلی حفظ می‌شود', () => {
    const old = players.sampleState();
    const raw = JSON.parse(JSON.stringify(old));
    raw.players.forEach(p => { delete p.registrationCompleted; delete p.docsApproved; });
    raw.config.rules = { maxReferralsAgent: 2, maxReferralsPartner: null };   // شکل قدیمی
    const n = players.normalizeState(raw);
    eq(engine.compute(n).grand.total, engine.compute(old).grand.total, 'جمع کل پس از مهاجرت');
    eq('rules' in n.config, false, 'قاعدهٔ سقف حذف شد');
    // نماینده‌ای که در داده قدیمی خرید اولیه نداشته، شرایط تکمیل‌نشده می‌گیرد
    const raw2 = JSON.parse(JSON.stringify(old)); raw2.players.forEach(p => { delete p.registrationCompleted; delete p.docsApproved; });
    raw2.firstPurchases = [];
    const n2 = players.normalizeState(raw2);
    eq(n2.players.filter(p => p.type === 'agent').every(p => p.registrationCompleted === false && p.docsApproved === false), true, 'بدون خرید → پرچم‌ها false');
  });

  /* ========== موارد تکمیلی ========== */
  test('نمونه کامل: جمع پلیرها = دفتر ریز = جمع سبدها = جمع گروه‌ها (۴۰٬۰۵۰٬۰۰۰ تومان)', () => {
    const s = players.sampleState(); const r = engine.compute(s);
    const byName = n => r.perPlayer[s.players.find(p => p.name === n).id].total;
    eq(byName('شریک نمونه ۱'), 21750000, 'شریک'); eq(byName('نماینده الف'), 8100000, 'الف');
    eq(byName('نماینده ب'), 6400000, 'ب'); eq(byName('نماینده ج'), 3800000, 'ج');
    eq(r.grand.total, 40050000, 'جمع کل');
    eq(r.baskets.partner.committed, 16000000, 'سبد شریک'); eq(r.baskets.agent.committed, 24050000, 'سبد نماینده');
    eq(r.controls.find(c => c.id === 'recon').ok, true, 'تطبیق');
    eq(r.allOk, true, 'همهٔ کنترل‌ها');
  });
  test('حق معرفی توسط شریک (E12) و حق ثبت قدیم/جدید به شریک (F12/G12)', () => {
    const s = fresh(); const P = mkPartner(s, 'ش', 0, 0);
    const A = mkAgent(s, 'الف', P.id, 15, 0); referrals.setReferrer(s, A.id, P.id); qualify(A); referrals.registerFirstPurchase(s, A.id, 10);
    eq(line(s, P.id, 'REF_PARTNER').amount, 10 * 50000, 'E12');
    eq(line(s, P.id, 'NEW_REG_PARTNER').amount, 10 * 150000, 'G12 (دستگاه‌های خرید اولیه)');
    eq(line(s, P.id, 'OLD_REG_PARTNER').amount, 5 * 150000, 'F12 (مازاد بر خرید اولیه)');
  });
  test('بدون خرید اولیه: معرفی به‌تنهایی حق معرفی (برای نماینده یا شریک) ایجاد نمی‌کند', () => {
    const s = fresh(); const P = mkPartner(s, 'ش', 0, 0);
    const A = mkAgent(s, 'الف', P.id, 5, 0); const B = mkAgent(s, 'ب', P.id, 5, 0);
    referrals.setReferrer(s, A.id, P.id); referrals.setReferrer(s, B.id, A.id);
    const r = engine.compute(s);
    eq(r.referralTotal, 0, 'حق معرفی');
  });
  test('حذف پلیر: وابستگی‌ها پاک می‌شود و محاسبه همچنان یکپارچه است', () => {
    const s = players.sampleState(); const A2 = s.players.find(p => p.name === 'نماینده ب');
    players.removePlayer(s, A2.id);
    eq(s.firstPurchases.some(e => e.agentId === A2.id), false, 'خرید اولیهٔ حذف‌شده');
    eq(s.players.some(p => p.referrerId === A2.id), false, 'ارجاع به معرف حذف‌شده');
    eq(engine.compute(s).controls.find(c => c.id === 'recon').ok, true, 'تطبیق');
  });
  test('اعتبارسنجی: مشمول تارگت بیش از ثبت‌شده و خرید اولیه بیش از ثبت‌شده خطا می‌دهند', () => {
    const s = fresh(); const P = mkPartner(s, 'ش', 2, 5);
    const A = mkAgent(s, 'الف', P.id, 3, 1); referrals.registerFirstPurchase(s, A.id, 9);
    const codes = players.validate(s).map(i => i.code);
    truthy(codes.includes('TARGET_GT_REG') && codes.includes('FP_GT_REG'), 'کدهای خطا یافت نشد');
    eq(engine.compute(s).controls.find(c => c.id === 'data').ok, false, 'کنترل ورودی FAIL');
  });
  test('نرمال‌سازی داده: خرید اولیهٔ تکراری و یتیم در داده‌های بازیابی‌شده حذف می‌شود', () => {
    const s = players.sampleState(); const raw = JSON.parse(JSON.stringify(s));
    raw.firstPurchases.push({ id: 'FP-9999', agentId: raw.firstPurchases[0].agentId, devices: 99 });
    raw.firstPurchases.push({ id: 'FP-9998', agentId: 'P-404', devices: 1 });
    const n = players.normalizeState(raw);
    eq(n.firstPurchases.length, 3, 'تعداد رویداد');
  });
  test('قالب‌بندی: جداکنندهٔ هزارگان، ارقام فارسی و تحلیل ورودی', () => {
    eq(calc.fa(1234567), '۱,۲۳۴,۵۶۷', 'fa');
    eq(calc.parseNumber('۱٬۲۳۴,۵۶۷'), 1234567, 'parse'); eq(calc.parseNumber(''), null, 'خالی');
  });
  test('CSV: ساختار و BOM فارسی', () => {
    const s = players.sampleState(); const r = engine.compute(s);
    const csv = reports.playersCSV(s, r);
    truthy(csv.charCodeAt(0) === 0xFEFF, 'BOM'); eq(csv.trim().split('\r\n').length, 1 + s.players.length, 'تعداد ردیف');
    truthy(reports.reportCSV(s, r).includes('PASS'), 'کنترل‌ها در CSV');
  });

  /* ========== بررسی‌های ایستای PWA (فقط Node) ========== */
  if (isNode) {
    const fs = require('fs'); const path = require('path'); const base = path.join(__dirname, '..');
    test('سناریو ۹ (ایستا) — فهرست پیش‌کش Service Worker کامل و آیکون‌ها/manifest معتبرند', () => {
      const sw = fs.readFileSync(path.join(base, 'sw.js'), 'utf8');
      const list = [...sw.matchAll(/'(\.\/[^']*|[^']+\.[a-z0-9]+)'/g)].map(m => m[1]).filter(x => /\.(html|css|js|png|ttf|webmanifest)$/.test(x) || x === './');
      truthy(list.length >= 18, 'فهرست پیش‌کش کوتاه است: ' + list.length);
      list.forEach(f => { if (f !== './') truthy(fs.existsSync(path.join(base, f.replace(/^\.\//, ''))), 'فایل پیش‌کش وجود ندارد: ' + f); });
      const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
      [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]).filter(u => !/^https?:/.test(u)).forEach(u => {
        truthy(list.includes('./' + u) || u === './', 'منبع index.html در پیش‌کش نیست: ' + u);
      });
      const mf = JSON.parse(fs.readFileSync(path.join(base, 'manifest.webmanifest'), 'utf8'));
      truthy(mf.icons.some(i => i.sizes === '192x192') && mf.icons.some(i => i.sizes === '512x512'), 'آیکون ۱۹۲/۵۱۲');
      mf.icons.forEach(i => truthy(fs.existsSync(path.join(base, i.src)), 'آیکون وجود ندارد: ' + i.src));
      eq(mf.display, 'standalone', 'display'); eq(mf.dir, 'rtl', 'dir');
      truthy(mf.start_url.startsWith('.') && mf.scope.startsWith('.'), 'مسیرها باید نسبی باشند (GitHub Project Pages)');
    });
    test('مسیرهای نسبی: هیچ مسیر مطلق «/» در HTML/CSS/manifest/sw نیست', () => {
      ['index.html', 'manifest.webmanifest', 'sw.js', 'css/style.css', 'css/responsive.css', 'css/splash.css'].forEach(f => {
        const t = fs.readFileSync(path.join(base, f), 'utf8');
        truthy(!/(?:src|href|url\(|start_url"\s*:\s*|scope"\s*:\s*)["']?\/(?!\/)[a-z]/i.test(t), 'مسیر مطلق در ' + f);
      });
    });
  }

  function runAll() {
    return tests.map(t => {
      try { t.fn(); return { name: t.name, pass: true }; }
      catch (e) { return { name: t.name, pass: false, error: e && e.message ? e.message : String(e) }; }
    });
  }
  return { runAll, count: () => tests.length };
});
