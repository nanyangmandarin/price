#!/usr/bin/env node
'use strict';
/*
 * Pencarian aturan multi-timeframe dengan disiplin latih/uji.
 *   node tools/search-mtf.js --dir data              (butuh data/XAUUSD_M30.csv, EURUSD, GBPUSD, AUDUSD; UTC)
 *   node tools/search-mtf.js --demo                  (data sintetis, hanya untuk menguji skrip)
 *
 * Protokol (ditetapkan sebelum melihat hasil):
 *  - Latih: 2020-01-01 s/d 2023-12-31. Uji: 2024-01-01 s/d akhir data (tidak dipakai saat memilih).
 *  - Satu konfigurasi yang sama untuk semua instrumen.
 *  - Lolos latih: >= 150 trade, win rate > 50%, rata-rata R > 0 (setelah spread).
 *  - 10 kandidat teratas (diurutkan menurut t-stat rata-rata R di data latih) dilaporkan SEMUA di data uji.
 *  - Bertahan meyakinkan di uji: win > 50%, avgR > 0, dan t-stat >= 2. Positif tapi t < 2 = tidak signifikan (bisa noise).
 */
const fs = require('fs');
const path = require('path');
const PA = require('../engine.js');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const INST = [['XAUUSD', 3], ['EURUSD', 1], ['GBPUSD', 1.2], ['AUDUSD', 1.2]];
const TRAIN_FROM = PA.toEpoch(arg('from', '2020-01-01'));
const SPLIT = PA.toEpoch(arg('split', '2024-01-01'));
const MIN_N = Number(arg('min-n', 150));

/* ---------------- data & event ---------------- */
const t0 = Date.now();
const data = INST.map(([sym, spreadPips], k) => {
  const inst = PA.INSTRUMENTS[sym];
  let m30;
  if (arg('demo')) m30 = PA.generateDemo('mixed', sym, Number(arg('bars', 60000)), 11 + k, { stepMin: 30 });
  else m30 = PA.parseCSV(fs.readFileSync(path.join(arg('dir', 'data'), sym + '_M30.csv'), 'utf8')).candles;
  const spread = spreadPips * inst.pipSize;
  const ctx = PA.prepareMTF({ m30 }, { spread, anchorMs: 22 * 3600000, dp: PA.inferPrecision(m30) });
  const ev = PA.mtfEvents(ctx).filter((e) => e.ts >= TRAIN_FROM);
  console.log(sym + ': ' + ctx.M.length + ' candle 30m, ' + ev.length + ' kandidat sinyal (' + Math.round((Date.now() - t0) / 1000) + ' dtk)');
  return { sym, M: ctx.M, ev, spread };
});

/* ---------------- ruang pencarian ---------------- */
const configs = [];
for (const thr of [5, 6, 7, 8, 9])
  for (const align of ['none', 'd1', 'd1h4'])
    for (const loc of [0, 1])
      for (const sess of ['all', 'lnny'])
        for (const pat of ['all', 'pinbar', 'engulfing'])
          for (const entry of ['stop', 'market'])
            for (const sl of ['pattern', 'atr1.5'])
              for (const tp of ['level', 0.5, 0.75, 1, 1.5, 2]) {
                if (tp === 'level' && (entry !== 'stop' || sl !== 'pattern')) continue;
                configs.push({ thr, align, loc, sess, pat, entry, sl, tp });
              }
const label = (c) => 'skor≥' + c.thr + ' tren:' + c.align + ' lokasi:' + (c.loc ? 'wajib' : 'bebas') + ' sesi:' + c.sess +
  ' pola:' + c.pat + ' entri:' + c.entry + ' SL:' + c.sl + ' TP:' + (c.tp === 'level' ? 'level' : c.tp + 'R');

function pass(c, e) {
  if (e.score < c.thr) return false;
  if (c.align === 'd1' && !(e.d1 > 0)) return false;
  if (c.align === 'd1h4' && !(e.d1 > 0 && e.h4 > 0)) return false;
  if (c.loc && !(e.loc >= 1)) return false;
  if (c.sess === 'lnny' && !(e.hour >= 7 && e.hour < 20)) return false;
  if (c.pat !== 'all' && e.key !== c.pat) return false;
  return true;
}

function planFor(c, e) {
  const d = e.dir;
  const a = e.atr;
  if (c.tp === 'level') {
    if (e.lvl.tooWide || !(e.lvl.rr1 >= 1.5)) return null;
    return { entry: e.lvl.entry, sl: e.lvl.sl, tp1: e.lvl.tp1 };
  }
  const entry = c.entry === 'stop' ? (d > 0 ? e.hi + 0.1 * a : e.lo - 0.1 * a) : (d > 0 ? -Infinity : Infinity);
  const ref = c.entry === 'stop' ? entry : e.close;
  let sl;
  if (c.sl === 'pattern') {
    sl = d > 0 ? e.lo - 0.25 * a : e.hi + 0.25 * a;
    const dist = d * (ref - sl);
    if (dist < 0.5 * a) sl = ref - d * 0.5 * a;
    if (dist > 3 * a) return null;
  } else sl = ref - d * 1.5 * a;
  return { entry, sl, tpR: c.tp };
}

const newAcc = () => ({ n: 0, w: 0, s: 0, s2: 0 });
const addAcc = (A, R) => { A.n++; if (R > 0) A.w++; A.s += R; A.s2 += R * R; };
const merge = (arr) => arr.reduce((A, B) => ({ n: A.n + B.n, w: A.w + B.w, s: A.s + B.s, s2: A.s2 + B.s2 }), newAcc());
const stat = (A) => {
  const m = A.n ? A.s / A.n : 0;
  const sd = A.n > 1 ? Math.sqrt(Math.max(0, (A.s2 - A.n * m * m) / (A.n - 1))) : 0;
  const w = PA.wilson(A.w, A.n);
  return { n: A.n, win: A.n ? A.w / A.n : 0, lo: w.lo, hi: w.hi, avgR: m, t: sd > 0 ? m / (sd / Math.sqrt(A.n)) : 0, totalR: A.s };
};

function run(c, keepTrades) {
  const res = data.map((d) => {
    const tr = newAcc();
    const te = newAcc();
    const trades = [];
    let next = 0;
    for (const e of d.ev) {
      if (e.i < next || !pass(c, e)) continue;
      const plan = planFor(c, e);
      if (!plan) continue;
      const r = PA.simulate(d.M, e.i, e.dir > 0 ? 'BUY' : 'SELL', plan, { spread: d.spread }, { fillWindow: 3, maxHold: 96 });
      next = r.next;
      if (!r.trade) continue;
      addAcc(e.ts < SPLIT ? tr : te, r.trade.R);
      if (keepTrades) trades.push({ ts: e.ts, R: r.trade.R });
    }
    return { sym: d.sym, tr, te, trades };
  });
  return { c, res, train: merge(res.map((r) => r.tr)), test: merge(res.map((r) => r.te)) };
}

/* ---------------- jalankan ---------------- */
const t1 = Date.now();
const all = configs.map((c) => run(c, false));
console.log('\n' + configs.length + ' konfigurasi diuji dalam ' + Math.round((Date.now() - t1) / 1000) + ' dtk. Latih: ' + PA.fmtEpoch(TRAIN_FROM).slice(0, 10) + ' s/d ' + PA.fmtEpoch(SPLIT - 1).slice(0, 10) + ', uji: sejak ' + PA.fmtEpoch(SPLIT).slice(0, 10));

const f = (x) => (x * 100).toFixed(1) + '%';
const fr = (x) => (x >= 0 ? '+' : '') + x.toFixed(3);
const line = (s) => 'n=' + String(s.n).padStart(4) + '  win ' + f(s.win).padStart(6) + ' (CI ' + f(s.lo) + '–' + f(s.hi) + ')  avgR ' + fr(s.avgR) + '  t=' + s.t.toFixed(2).padStart(5) + '  total ' + fr(s.totalR).padStart(8) + 'R';

const baseline = all.find((x) => x.c.thr === 7 && x.c.align === 'none' && x.c.loc === 1 && x.c.sess === 'all' && x.c.pat === 'all' && x.c.tp === 'level');
console.log('\nPEMBANDING (aturan sekarang): ' + label(baseline.c));
console.log('  latih: ' + line(stat(baseline.train)));
console.log('  uji  : ' + line(stat(baseline.test)));

const qualified = all.filter((x) => { const s = stat(x.train); return s.n >= MIN_N && s.win > 0.5 && s.avgR > 0; });
console.log('\nLolos syarat latih (n≥' + MIN_N + ', win>50%, avgR>0): ' + qualified.length + ' dari ' + all.length + ' konfigurasi.');

const winOnly = all.filter((x) => { const s = stat(x.train); return s.n >= MIN_N && s.win > 0.5; });
console.log('Win rate latih >50% (tanpa syarat untung): ' + winOnly.length + ' konfigurasi; di antaranya avgR latih ≤ 0: ' + winOnly.filter((x) => stat(x.train).avgR <= 0).length);

const top = qualified.sort((a, b) => stat(b.train).t - stat(a.train).t).slice(0, 10);
console.log('\n=== 10 KANDIDAT TERATAS (dipilih HANYA dari data latih) — semua dilaporkan di data uji ===');
top.forEach((x, k) => {
  const st = stat(x.train);
  const ss = stat(x.test);
  console.log('\n#' + (k + 1) + ' ' + label(x.c));
  console.log('  latih: ' + line(st));
  const verdict = ss.win > 0.5 && ss.avgR > 0 ? (ss.t >= 2 ? '   ✓ BERTAHAN (signifikan)' : '   ~ positif tapi tidak signifikan') : '   ✗ tidak bertahan';
  console.log('  uji  : ' + line(ss) + verdict);
  console.log('  uji per instrumen: ' + x.res.map((r) => { const s = stat(r.te); return r.sym + ' n' + s.n + ' ' + f(s.win) + ' ' + fr(s.avgR); }).join(' | '));
});

const pos = top.filter((x) => { const s = stat(x.test); return s.win > 0.5 && s.avgR > 0; });
const sig = pos.filter((x) => stat(x.test).t >= 2);
console.log('\nRINGKASAN: dari ' + top.length + ' kandidat, ' + pos.length + ' tetap win>50% & avgR>0 di data uji; ' + sig.length + ' di antaranya signifikan (t≥2).');

// Rincian per tahun untuk kandidat #1 (stabilitas)
if (top.length) {
  const d = run(top[0].c, true);
  const byY = {};
  d.res.forEach((r) => r.trades.forEach((t) => { const y = new Date(t.ts).getUTCFullYear(); (byY[y] = byY[y] || newAcc()); addAcc(byY[y], t.R); }));
  console.log('\nKandidat #1 per tahun (gabungan 4 instrumen):');
  Object.keys(byY).sort().forEach((y) => console.log('  ' + y + ': ' + line(stat(byY[y]))));
}
console.log('\nTotal waktu ' + Math.round((Date.now() - t0) / 1000) + ' dtk.');
