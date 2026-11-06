/*
 * export.js — دانلود فایل (CSV/JSON)، انتخاب فایل برای بازیابی، چاپ/PDF
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.TT = root.TT || {}; root.TT.exporter = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function stamp() {
    const d = new Date(); const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 500);
  }

  function pickTextFile(accept) {
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept || '.json,application/json';
      inp.onchange = () => {
        const f = inp.files && inp.files[0];
        if (!f) return reject(new Error('فایلی انتخاب نشد.'));
        const r = new FileReader();
        r.onload = () => resolve({ name: f.name, text: String(r.result) });
        r.onerror = () => reject(new Error('خواندن فایل ناموفق بود.'));
        r.readAsText(f, 'utf-8');
      };
      inp.click();
    });
  }

  /** چاپ یا ذخیره PDF از طریق Print مرورگر */
  function printPage() { window.print(); }

  return { stamp, download, pickTextFile, printPage };
});
