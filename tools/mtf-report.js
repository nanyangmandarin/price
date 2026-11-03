#!/usr/bin/env node
'use strict';
/*
 * Laporan backtest multi-timeframe (1D → 4H → 30m) dari file CSV.
 *
 *   node tools/mtf-report.js --m30 data/XAUUSD_M30.csv --inst XAUUSD --spread 3 --from 2020-01-01
 *   (opsional) --h4 data/XAUUSD_H4.csv --d1 data/XAUUSD_D1.csv   → bila tidak ada, diturunkan dari 30m
 *   (opsional) --threshold 7 --minrr 1.5 --anchor 22 --json hasil.json
 *   --anchor: jam awal hari untuk menurunkan 4H/1D dari 30m (data UTC → 22 agar hari FX bermula ±22:00 UTC)
 */
const fs = require('fs');
const PA = require('../engine.js');

function args() {
  const a = {};
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) if (v[i].startsWith('--')) a[v[i].slice(2)] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true;
  return a;
}
const pct = (x) => (x * 100).toFixed(1) + '%';
const pad = (s, n) => String(s).padStart(n);

function row(label, g) {
  if (!g || !g.n) return pad(label, 10) + '  —';
  return pad(label, 10) + pad(g.n, 7) + pad(pct(g.winRate), 9) + pad(pct(g.ciLo) + '–' + pct(g.ciHi), 16) +
    pad((g.avgR >= 0 ? '+' : '') + g.avgR.toFixed(2), 9) + pad((g.totalR >= 0 ? '+' : '') + g.totalR.toFixed(1), 9) +
    pad(isFinite(g.profitFactor) ? g.profitFactor.toFixed(2) : '∞', 7);
}
const HEAD = pad('', 10) + pad('Trade', 7) + pad('Win', 9) + pad('CI 95%', 16) + pad('Avg R', 9) + pad('Total R', 9) + pad('PF', 7);

(async () => {
  const a = args();
  if (!a.m30) {
    console.error('Pemakaian: node tools/mtf-report.js --m30 file.csv [--h4 file.csv] [--d1 file.csv] [--inst XAUUSD] [--spread 3] [--from 2020-01-01] [--threshold 7] [--minrr 1.5] [--anchor 22] [--json out.json]');
    process.exit(1);
  }
  const inst = PA.INSTRUMENTS[(a.inst || 'XAUUSD').toUpperCase()];
  if (!inst) { console.error('Instrumen tidak dikenal: ' + a.inst); process.exit(1); }
  const load = (f) => PA.parseCSV(fs.readFileSync(f, 'utf8'));
  const m30 = load(a.m30);
  const h4 = a.h4 ? load(a.h4) : null;
  const d1 = a.d1 ? load(a.d1) : null;
  [m30, h4, d1].filter(Boolean).forEach((r) => r.warnings.forEach((w) => console.log('! ' + w)));

  const opts = {
    spread: (a.spread != null ? Number(a.spread) : 3) * inst.pipSize,
    minRR: a.minrr ? Number(a.minrr) : 1.5,
    mtfThreshold: a.threshold ? Number(a.threshold) : 7,
    dp: PA.inferPrecision(m30.candles),
    anchorMs: (a.anchor ? Number(a.anchor) : 0) * 3600000,
  };
  const ctx = PA.prepareMTF({ m30: m30.candles, h4: h4 && h4.candles, d1: d1 && d1.candles }, opts);
  if (h4) { const al = PA.checkAlignment(ctx.M, ctx.H, 4 * 3600000); console.log('Sinkron 4H↔30m: ' + pct(al) + (al < 0.9 ? '  ⚠ ZONA WAKTU TIDAK SINKRON — hasil tidak valid' : '')); }
  if (d1) { const al = PA.checkAlignment(ctx.M, ctx.D, 24 * 3600000); console.log('Sinkron 1D↔30m: ' + pct(al) + (al < 0.9 ? '  ⚠ ZONA WAKTU TIDAK SINKRON — hasil tidak valid' : '')); }

  const fromTs = a.from ? PA.toEpoch(a.from) : null;
  const t0 = Date.now();
  const bt = await PA.backtestMTF(ctx, { fromTs });
  const s = PA.summarizeMTF(bt.trades);

  console.log('\n=== Backtest multi-timeframe ' + inst.name + ' ===');
  console.log('Data 30m : ' + ctx.M.length + ' candle, ' + ctx.M[0].t + ' → ' + ctx.M[ctx.M.length - 1].t);
  console.log('4H / 1D  : ' + ctx.H.length + ' / ' + ctx.D.length + ' candle' + (ctx.derived.h4 || ctx.derived.d1 ? ' (diturunkan dari 30m)' : ''));
  console.log('Aturan   : skor ≥ ' + opts.mtfThreshold + ', RR TP1 ≥ ' + opts.minRR + ', spread ' + (opts.spread / inst.pipSize).toFixed(1) + ' pip, keluar penuh di TP1/SL, maks 96 candle');
  console.log('Waktu    : ' + (Date.now() - t0) + ' ms\n');
  console.log(HEAD);
  console.log(row('Semua', s.overall));
  s.bySide.forEach((g) => console.log(row(g.key, g)));
  console.log('\nPer tahun'); console.log(HEAD);
  s.byYear.forEach((g) => console.log(row(g.key, g)));
  console.log('\nPer skor konfluensi (probabilitas menang historis)'); console.log(HEAD);
  s.byScore.forEach((g) => console.log(row(g.key >= s.scoreCap ? g.key + '+' : g.key, g)));
  if (s.split) {
    console.log('\nUji di luar sampel (split ' + PA.fmtEpoch(s.split.splitTs) + ')'); console.log(HEAD);
    console.log(row('In-sample', s.split.inSample)); console.log(row('Out-sample', s.split.outSample));
  }
  const o = s.overall;
  if (o.n) {
    console.log('\nWin rate impas (ekspektasi 0 R): ' + pct(o.breakEven) + ' · rata-rata menang ' + o.avgWin.toFixed(2) + ' R, rata-rata kalah ' + o.avgLoss.toFixed(2) + ' R · max drawdown ' + o.maxDD.toFixed(1) + ' R');
  }
  console.log('\nKesimpulan: ' + s.verdict);
  if (a.json) { fs.writeFileSync(a.json, JSON.stringify({ opts, summary: s, trades: bt.trades }, (k, v) => (k === 'equity' ? undefined : v), 1)); console.log('JSON ditulis ke ' + a.json); }
})().catch((e) => { console.error('GAGAL: ' + e.message); process.exit(1); });
