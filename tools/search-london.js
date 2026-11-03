#!/usr/bin/env node
'use strict';
/*
 * Pencarian strategi breakout sesi London dengan disiplin latih/uji (protokol sama dengan search-mtf.js).
 *   node tools/search-london.js --dir data     (data/XAUUSD_M30.csv, EURUSD, GBPUSD, AUDUSD; waktu UTC)
 *   node tools/search-london.js --demo         (data sintetis untuk menguji skrip)
 * Latih 2020–2023, uji 2024–akhir data. Satu konfigurasi untuk keempat instrumen.
 * Lolos latih: >= 150 trade, win > 50%, rata-rata R > 0. Bertahan di uji: win > 50%, rata-rata R > 0, t >= 2.
 * Biaya: spread + slippage (XAU 1 pip, forex 0,2 pip) pada entri & exit SL.
 * Urutan intrabar: seleksi & penilaian memakai mode KONSERVATIF (batas bawah); mode lintasan dilaporkan sebagai batas atas.
 */
const fs = require('fs');
const path = require('path');
const PA = require('../engine.js');
const L = require('../london.js');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const INST = [['XAUUSD', 3, 1], ['EURUSD', 1, 0.2], ['GBPUSD', 1.2, 0.2], ['AUDUSD', 1.2, 0.2]]; // [simbol, spread pip, slippage pip]
const FROM = PA.toEpoch(arg('from', '2020-01-01'));
const SPLIT = PA.toEpoch(arg('split', '2024-01-01'));
const MIN_N = Number(arg('min-n', 150));
const MODE = arg('mode', 'conservative') === 'path' ? 'path' : 'conservative'; // mode seleksi

const t0 = Date.now();
const data = INST.map(([sym, pips, slipPips], k) => {
  const inst = PA.INSTRUMENTS[sym];
  const M = arg('demo')
    ? PA.generateDemo('mixed', sym, Number(arg('bars', 60000)), 21 + k, { stepMin: 30 })
    : PA.parseCSV(fs.readFileSync(path.join(arg('dir', 'data'), sym + '_M30.csv'), 'utf8')).candles;
  M.forEach((c) => { c.ts = PA.toEpoch(c.t); });
  const days = L.buildDays(M);
  console.log(sym + ': ' + M.length + ' candle 30m, ' + days.length + ' hari');
  return { sym, M, days, spread: pips * inst.pipSize, slip: slipPips * inst.pipSize };
});

const configs = [];
for (const rangeStart of [0, 2, 4])
  for (const rangeEnd of [7, 8])
    for (const windowEnd of [11, 13])
      for (const exitHour of [16, 20])
        for (const entry of ['stop', 'close'])
          for (const buffer of [0, 0.1])
            for (const sl of ['opposite', 'mid'])
              for (const tp of [0.5, 1, 1.5, 2, null])
                for (const rangeFilter of ['all', 'narrow', 'notwide'])
                  for (const trend of [false, true])
                    configs.push({ rangeStart, rangeEnd, windowEnd, exitHour, entry, buffer, sl, tp, rangeFilter, trend });
const hh = (h) => String(h).padStart(2, '0') + ':00';
const label = (c) => 'range ' + hh(c.rangeStart) + '–' + hh(c.rangeEnd) + ' · entri ' + c.entry + ' s/d ' + hh(c.windowEnd) + ' · buffer ' + c.buffer +
  ' · SL ' + c.sl + ' · TP ' + (c.tp == null ? 'tanpa' : c.tp + 'R') + ' · keluar ' + hh(c.exitHour) + ' · range ' + c.rangeFilter + ' · tren ' + (c.trend ? 'ya' : 'tidak') + ' (jam London)';

const newAcc = () => ({ n: 0, w: 0, s: 0, s2: 0 });
const addAcc = (A, R) => { A.n++; if (R > 0) A.w++; A.s += R; A.s2 += R * R; };
const merge = (arr) => arr.reduce((A, B) => ({ n: A.n + B.n, w: A.w + B.w, s: A.s + B.s, s2: A.s2 + B.s2 }), newAcc());
const stat = (A) => {
  const m = A.n ? A.s / A.n : 0;
  const sd = A.n > 1 ? Math.sqrt(Math.max(0, (A.s2 - A.n * m * m) / (A.n - 1))) : 0;
  const w = PA.wilson(A.w, A.n);
  return { n: A.n, win: A.n ? A.w / A.n : 0, lo: w.lo, hi: w.hi, avgR: m, t: sd > 0 ? m / (sd / Math.sqrt(A.n)) : 0, totalR: A.s };
};

function evaluate(c, keep, mode) {
  const res = data.map((d) => {
    const r = L.run(d.M, d.days, c, d.spread, mode || MODE, d.slip);
    const tr = newAcc();
    const te = newAcc();
    for (const t of r.trades) { if (t.ts < FROM) continue; addAcc(t.ts < SPLIT ? tr : te, t.R); }
    return { sym: d.sym, tr, te, trades: keep ? r.trades.filter((t) => t.ts >= FROM) : null, ambiguous: r.ambiguous };
  });
  return { c, res, train: merge(res.map((r) => r.tr)), test: merge(res.map((r) => r.te)) };
}

const t1 = Date.now();
const all = configs.map((c) => evaluate(c, false));
console.log('\nBiaya: spread + slippage; urutan intrabar: ' + (MODE === 'path' ? 'LINTASAN (batas atas, optimis)' : 'konservatif (batas bawah)') + '.');
console.log(configs.length + ' konfigurasi diuji dalam ' + Math.round((Date.now() - t1) / 1000) + ' dtk. Latih: sejak ' + PA.fmtEpoch(FROM).slice(0, 10) + ' s/d ' + PA.fmtEpoch(SPLIT - 1).slice(0, 10) + ', uji: sejak ' + PA.fmtEpoch(SPLIT).slice(0, 10));

const f = (x) => (x * 100).toFixed(1) + '%';
const fr = (x) => (x >= 0 ? '+' : '') + x.toFixed(3);
const line = (s) => 'n=' + String(s.n).padStart(5) + '  win ' + f(s.win).padStart(6) + ' (CI ' + f(s.lo) + '–' + f(s.hi) + ')  avgR ' + fr(s.avgR) + '  t=' + s.t.toFixed(2).padStart(5) + '  total ' + fr(s.totalR).padStart(9) + 'R';

const classic = all.find((x) => x.c.rangeStart === 0 && x.c.rangeEnd === 7 && x.c.windowEnd === 11 && x.c.exitHour === 16 && x.c.entry === 'stop' && x.c.buffer === 0 && x.c.sl === 'opposite' && x.c.tp === 1 && x.c.rangeFilter === 'all' && !x.c.trend);
console.log('\nVERSI KLASIK: ' + label(classic.c));
console.log('  latih: ' + line(stat(classic.train)));
console.log('  uji  : ' + line(stat(classic.test)));

const winOnly = all.filter((x) => { const s = stat(x.train); return s.n >= MIN_N && s.win > 0.5; });
const qualified = all.filter((x) => { const s = stat(x.train); return s.n >= MIN_N && s.win > 0.5 && s.avgR > 0; });
console.log('\nWin rate latih >50%: ' + winOnly.length + ' konfigurasi; di antaranya rugi (avgR ≤ 0): ' + winOnly.filter((x) => stat(x.train).avgR <= 0).length);
console.log('Lolos syarat latih (n≥' + MIN_N + ', win>50%, avgR>0): ' + qualified.length + ' dari ' + all.length);
console.log('Untung di latih apa pun win rate-nya (avgR>0, t≥2): ' + all.filter((x) => { const s = stat(x.train); return s.n >= MIN_N && s.avgR > 0 && s.t >= 2; }).length);

const top = qualified.sort((a, b) => stat(b.train).t - stat(a.train).t).slice(0, 10);
console.log('\n=== 10 KANDIDAT TERATAS (dipilih HANYA dari data latih) — semua dilaporkan di data uji ===');
top.forEach((x, k) => {
  const st = stat(x.train);
  const ss = stat(x.test);
  const verdict = ss.win > 0.5 && ss.avgR > 0 ? (ss.t >= 2 ? '   ✓ BERTAHAN (signifikan)' : '   ~ positif tapi tidak signifikan') : '   ✗ tidak bertahan';
  console.log('\n#' + (k + 1) + ' ' + label(x.c));
  console.log('  latih: ' + line(st));
  console.log('  uji  : ' + line(ss) + verdict);
  const other = MODE === 'path' ? 'conservative' : 'path';
  console.log('  uji (mode ' + (other === 'path' ? 'lintasan, batas atas' : 'konservatif, batas bawah') + '): ' + line(stat(evaluate(x.c, false, other).test)));
  console.log('  uji per instrumen: ' + x.res.map((r) => { const s = stat(r.te); return r.sym + ' n' + s.n + ' ' + f(s.win) + ' ' + fr(s.avgR) + ' t' + s.t.toFixed(1); }).join(' | '));
});
const pos = top.filter((x) => { const s = stat(x.test); return s.win > 0.5 && s.avgR > 0; });
console.log('\nRINGKASAN: dari ' + top.length + ' kandidat, ' + pos.length + ' tetap win>50% & avgR>0 di data uji; ' + pos.filter((x) => stat(x.test).t >= 2).length + ' signifikan (t≥2).');

// Sebagai pembanding: kandidat terbaik TANPA syarat win rate (murni ekspektasi), juga dipilih dari data latih
const bestExp = all.filter((x) => stat(x.train).n >= MIN_N).sort((a, b) => stat(b.train).t - stat(a.train).t).slice(0, 5);
console.log('\n=== 5 TERATAS menurut ekspektasi saja (tanpa syarat win rate), dipilih dari data latih ===');
bestExp.forEach((x, k) => {
  const ss = stat(x.test);
  console.log('#' + (k + 1) + ' ' + label(x.c));
  console.log('  latih: ' + line(stat(x.train)));
  console.log('  uji  : ' + line(ss) + (ss.avgR > 0 && ss.t >= 2 ? '   ✓ signifikan' : ss.avgR > 0 ? '   ~ positif, tidak signifikan' : '   ✗'));
});

if (top.length) {
  const d = evaluate(top[0].c, true);
  const byY = {};
  d.res.forEach((r) => r.trades.forEach((t) => { const y = new Date(t.ts).getUTCFullYear(); (byY[y] = byY[y] || newAcc()); addAcc(byY[y], t.R); }));
  console.log('\nKandidat #1 per tahun (gabungan 4 instrumen):');
  Object.keys(byY).sort().forEach((y) => console.log('  ' + y + ': ' + line(stat(byY[y]))));
  console.log('Hari dilewati karena satu candle menembus dua sisi: ' + d.res.map((r) => r.sym + ' ' + r.ambiguous).join(', '));
}
console.log('\nTotal waktu ' + Math.round((Date.now() - t0) / 1000) + ' dtk.');
