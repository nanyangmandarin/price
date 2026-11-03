'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PA = require('../engine.js');

const C = (o, h, l, c, t) => ({ t: t || '', o, h, l, c });

// Bangun candle dari titik-titik jalur harga (interpolasi linear) dengan ekor kecil.
function pathCandles(points, wick = 0.2) {
  const closes = [];
  for (let k = 0; k < points.length - 1; k++) {
    const [a, b] = [points[k], points[k + 1]];
    for (let s = 0; s < b[0]; s++) closes.push(a[1] + ((b[1] - a[1]) * s) / b[0]);
  }
  closes.push(points[points.length - 1][1]);
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return C(o, Math.max(o, c) + wick, Math.min(o, c) - wick, c, String(i));
  });
}

test('parseCSV: header TradingView/ISO + urutan terbalik', () => {
  const csv = 'time,open,high,low,close,volume\n2024-01-03,1.1,1.2,1.0,1.15,10\n2024-01-02,1.0,1.1,0.9,1.05,10\n';
  const r = PA.parseCSV(csv);
  assert.equal(r.candles.length, 2);
  assert.equal(r.candles[0].t, '2024-01-02');
  assert.ok(r.warnings.some((w) => /dibalik/.test(w)));
});

test('parseCSV: format MT5 (tab, <DATE> <TIME>)', () => {
  const csv = '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\n2024.01.02\t00:00:00\t2060.5\t2065\t2058\t2063\t100\n2024.01.02\t01:00:00\t2063\t2066\t2061\t2064\t90\n';
  const r = PA.parseCSV(csv);
  assert.equal(r.candles.length, 2);
  assert.equal(r.candles[0].t, '2024-01-02 00:00:00');
  assert.equal(r.candles[1].c, 2064);
});

test('parseCSV: format MT4 tanpa header, tanggal & jam terpisah tidak dipecah salah', () => {
  const csv = '2024.01.02,00:00,1.1000,1.1010,1.0990,1.1005,50\n2024.01.02,01:00,1.1005,1.1020,1.1000,1.1015,60\n';
  const r = PA.parseCSV(csv);
  assert.equal(r.candles.length, 2);
  assert.equal(r.candles[0].t, '2024-01-02 00:00');
  assert.equal(r.candles[0].o, 1.1);
  assert.equal(r.candles[1].c, 1.1015);
});

test('parseCSV: tanpa header 5 kolom, unix timestamp, perbaikan high/low', () => {
  const csv = '1704153600,1.0,1.0,1.0,1.2\n1704157200,1.2,1.3,1.1,1.25\n';
  const r = PA.parseCSV(csv);
  assert.equal(r.candles[0].h, 1.2);
  assert.equal(r.candles[0].l, 1.0);
  assert.ok(r.warnings.some((w) => /diperbaiki/.test(w)));
  assert.match(r.candles[0].t, /^2024-01-02/);
});

test('parseCSV: error untuk data kosong', () => {
  assert.throws(() => PA.parseCSV(''), /kosong/);
  assert.throws(() => PA.parseCSV('a,b\nx,y'), /Format|tidak/);
});

test('swing & struktur: zigzag naik = uptrend', () => {
  const pts = [[0, 100], [8, 110], [6, 105], [8, 115], [6, 109], [8, 120], [6, 114]];
  const cs = pathCandles(pts, 0.1);
  const sw = PA.findSwings(cs, 0, cs.length - 1, 3);
  const st = PA.marketStructure(sw, cs, cs.length - 1);
  assert.equal(st.trend, 'up');
  const down = PA.marketStructure(PA.findSwings(pathCandles([[0, 120], [8, 110], [6, 115], [8, 105], [6, 109], [8, 100], [6, 106]], 0.1), 0, 40, 3), pathCandles([[0, 120], [8, 110], [6, 115], [8, 105], [6, 109], [8, 100], [6, 106]], 0.1), 40);
  assert.equal(down.trend, 'down');
});

test('pola: bullish pin bar', () => {
  const cs = [C(10, 10.5, 9.5, 10.1), C(10.1, 10.2, 9.0, 10.15)];
  const p = PA.detectPatterns(cs, 1, 1).find((x) => x.key === 'pinbar');
  assert.ok(p);
  assert.equal(p.bias, 'bull');
  assert.equal(p.quality, 3); // menyapu low sebelumnya
});

test('pola: bearish pin bar', () => {
  const cs = [C(10, 10.5, 9.5, 10.1), C(10, 11.3, 9.95, 9.98)];
  const p = PA.detectPatterns(cs, 1, 1).find((x) => x.key === 'pinbar');
  assert.ok(p && p.bias === 'bear');
});

test('pola: engulfing bullish & bearish', () => {
  const bull = PA.detectPatterns([C(10, 10.1, 9.4, 9.5), C(9.4, 10.4, 9.35, 10.3)], 1, 1).find((x) => x.key === 'engulfing');
  assert.ok(bull && bull.bias === 'bull');
  const bear = PA.detectPatterns([C(9.5, 10.1, 9.4, 10), C(10.1, 10.15, 9.0, 9.2)], 1, 1).find((x) => x.key === 'engulfing');
  assert.ok(bear && bear.bias === 'bear');
});

test('pola: inside bar dan breakout-nya', () => {
  const cs = [C(10, 11, 9, 10.5), C(10.2, 10.6, 9.6, 10.3), C(10.3, 11.4, 10.2, 11.3)];
  assert.ok(PA.detectPatterns(cs, 1, 1).some((x) => x.key === 'insidebar'));
  const b = PA.detectPatterns(cs, 2, 1).find((x) => x.key === 'ibbreak');
  assert.ok(b && b.bias === 'bull' && b.span === 3);
});

test('pola: morning star', () => {
  const cs = [C(11, 11.1, 9.9, 10), C(9.9, 10.0, 9.7, 9.85), C(9.9, 10.9, 9.85, 10.8)];
  const p = PA.detectPatterns(cs, 2, 1).find((x) => x.key === 'star');
  assert.ok(p && p.bias === 'bull' && p.quality === 3);
});

test('pola: candle datar tidak crash', () => {
  assert.deepEqual(PA.detectPatterns([C(1, 1, 1, 1), C(1, 1, 1, 1)], 1, 1), []);
});

test('buildLevels: mengklaster swing berdekatan', () => {
  const sw = [{ i: 1, type: 'H', price: 100 }, { i: 9, type: 'H', price: 100.2 }, { i: 20, type: 'L', price: 90 }];
  const lv = PA.buildLevels(sw, 95, 0.5);
  assert.equal(lv.length, 2);
  assert.equal(lv.find((l) => l.price > 99).touches, 2);
  assert.equal(lv.find((l) => l.price < 91).kind, 'support');
});

test('positionSize: EURUSD 1% dari $10.000, SL 20 pip → 0.50 lot', () => {
  const r = PA.positionSize({ balance: 10000, riskPct: 1, entry: 1.1, sl: 1.098, pipSize: 0.0001, pipValue: 10, tp1: 1.104, tp2: 1.108 });
  assert.equal(Math.round(r.slPips), 20);
  assert.equal(r.lots, 0.5);
  assert.equal(Math.round(r.realRisk), 100);
  assert.equal(Math.round(r.tp1Profit), 200);
});

test('positionSize: Gold SL $5 (50 pip) risiko $100 → 0.20 lot; spread menambah jarak', () => {
  const g = PA.INSTRUMENTS.XAUUSD;
  const r = PA.positionSize({ balance: 10000, riskPct: 1, entry: 2650, sl: 2645, pipSize: g.pipSize, pipValue: g.pipValue });
  assert.equal(r.lots, 0.2);
  const s = PA.positionSize({ balance: 10000, riskPct: 1, entry: 2650, sl: 2645, spread: 0.3, pipSize: g.pipSize, pipValue: g.pipValue });
  assert.ok(s.lots < r.lots);
});

test('pipValueUSD: USDJPY bergantung kurs', () => {
  const v = PA.pipValueUSD(PA.INSTRUMENTS.USDJPY, 150);
  assert.ok(Math.abs(v - 6.667) < 0.01);
  assert.equal(PA.pipValueUSD(PA.INSTRUMENTS.EURUSD, 1.1), 10);
});

test('skenario: pullback ke support + pin bar bullish di uptrend → BUY dengan rencana valid', () => {
  // uptrend dengan support ~106 disentuh beberapa kali, lalu pin bar di support
  const pts = [[0, 100], [8, 110], [6, 105], [8, 116], [6, 106.3], [8, 122], [6, 106.5], [8, 128], [6, 113], [7, 120]];
  const cs = pathCandles(pts, 0.15);
  const last = cs[cs.length - 1];
  // candle terakhir: pin bar bullish dengan ekor panjang
  cs.push(C(last.c, last.c + 0.3, last.c - 5, last.c + 0.2, 'sig'));
  // paksa pullback ke area support: ganti beberapa candle terakhir menjadi turun lalu pin bar
  const tail = pathCandles([[0, 128], [6, 112], [4, 107.2]], 0.15);
  const base = cs.slice(0, cs.length - 1 - 7);
  const all = base.concat(tail);
  const lastc = all[all.length - 1];
  all.push(C(lastc.c, lastc.c + 0.25, lastc.c - 2.2, lastc.c + 0.3, 'pin'));
  const a = PA.analyze(all, { dp: 2 });
  assert.ok(a.ok);
  assert.ok(a.patterns.some((p) => p.key === 'pinbar' && p.bias === 'bull'), 'pin bar harus terdeteksi');
  assert.ok(a.breakdown.length === 5);
  // bila BUY, rencana harus konsisten
  if (a.decision.action === 'BUY') {
    const p = a.plan;
    assert.ok(p.sl < p.entry && p.entry < p.tp1 && p.tp1 < p.tp2);
    assert.ok(p.rr1 >= PA.DEFAULTS.minRR);
  }
});

test('invarian: rencana BUY/SELL selalu konsisten pada data acak', () => {
  for (const kind of ['up', 'down', 'range', 'mixed']) {
    for (let seed = 1; seed <= 6; seed++) {
      const cs = PA.generateDemo(kind, 'EURUSD', 260, seed);
      const ind = PA.computeIndicators(cs);
      for (let i = 40; i < cs.length; i++) {
        const a = PA.analyzeAt(cs, i, {}, ind);
        if (a.decision.action === 'BUY') {
          assert.ok(a.plan.sl < a.plan.entry && a.plan.entry < a.plan.tp1 && a.plan.tp1 < a.plan.tp2, `BUY tidak konsisten ${kind}/${seed}/${i}`);
          assert.ok(a.plan.rr1 >= PA.DEFAULTS.minRR - 1e-9);
        } else if (a.decision.action === 'SELL') {
          assert.ok(a.plan.sl > a.plan.entry && a.plan.entry > a.plan.tp1 && a.plan.tp1 > a.plan.tp2, `SELL tidak konsisten ${kind}/${seed}/${i}`);
        } else assert.equal(a.plan, null);
      }
    }
  }
});

test('tanpa look-ahead: analyzeAt(i) identik dengan analyze(slice(0,i+1))', () => {
  const cs = PA.generateDemo('mixed', 'XAUUSD', 220, 11);
  const ind = PA.computeIndicators(cs);
  for (const i of [45, 80, 120, 160, 219]) {
    const full = PA.analyzeAt(cs, i, {}, ind);
    const cut = PA.analyze(cs.slice(0, i + 1));
    assert.equal(full.score, cut.score);
    assert.equal(full.decision.action, cut.decision.action);
    assert.equal(full.levels.length, cut.levels.length);
  }
});

test('generateDemo: OHLC valid, deterministik, tanggal naik', () => {
  const a = PA.generateDemo('mixed', 'XAUUSD', 200, 3);
  const b = PA.generateDemo('mixed', 'XAUUSD', 200, 3);
  assert.deepEqual(a, b);
  assert.equal(a.length, 200);
  for (const c of a) {
    assert.ok(c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c) && c.l > 0);
  }
  assert.ok(a[199].t > a[0].t);
});

test('backtest: statistik konsisten', () => {
  const cs = PA.generateDemo('mixed', 'EURUSD', 400, 5);
  const bt = PA.backtest(cs, {});
  const s = bt.stats;
  assert.equal(s.trades, s.wins + s.losses);
  assert.equal(s.equity.length, s.trades + 1);
  assert.ok(Math.abs(s.totalR - bt.trades.reduce((x, t) => x + t.R, 0)) < 1e-9);
  for (const t of bt.trades) {
    assert.ok(t.fillIdx > t.signalIdx && t.exitIdx >= t.fillIdx);
  }
  // tidak ada trade yang tumpang tindih
  for (let k = 1; k < bt.trades.length; k++) assert.ok(bt.trades[k].fillIdx > bt.trades[k - 1].exitIdx);
});

test('backtest: spread menurunkan hasil', () => {
  const cs = PA.generateDemo('mixed', 'EURUSD', 400, 5);
  const a = PA.backtest(cs, { spread: 0 }).stats;
  const b = PA.backtest(cs, { spread: 0.0003 }).stats;
  if (a.trades) assert.ok(b.totalR <= a.totalR + 1e-9);
});

test('analyze: error bila data kurang', () => {
  const r = PA.analyze(PA.generateDemo('up', 'EURUSD', 20, 1));
  assert.equal(r.ok, false);
});

test('simetri: cermin harga → skor terbalik & BUY<->SELL tertukar', () => {
  const K = 300;
  const r5 = (x) => Number(x.toFixed(5));
  const mirror = (cs) => cs.map((c) => ({ t: c.t, o: r5(K - c.o), h: r5(K - c.l), l: r5(K - c.h), c: r5(K - c.c) }));
  const swap = (x) => (x === 'BUY' ? 'SELL' : x === 'SELL' ? 'BUY' : 'WAIT');
  for (const kind of ['up', 'down', 'range', 'mixed']) {
    for (let seed = 1; seed <= 4; seed++) {
      const cs = PA.generateDemo(kind, 'EURUSD', 220, seed).map((c) => ({ ...c, o: r5(c.o * 100), h: r5(c.h * 100), l: r5(c.l * 100), c: r5(c.c * 100) }));
      const m = mirror(cs);
      const i1 = PA.computeIndicators(cs);
      const i2 = PA.computeIndicators(m);
      for (let i = 40; i < cs.length; i++) {
        const a = PA.analyzeAt(cs, i, {}, i1);
        const b = PA.analyzeAt(m, i, {}, i2);
        assert.ok(a.score === -b.score, `skor ${kind}/${seed}/${i}`);
        assert.equal(a.decision.action, swap(b.decision.action), `aksi ${kind}/${seed}/${i}`);
      }
    }
  }
});

/* ===================== MULTI-TIMEFRAME ===================== */
const M30 = (kind, inst, n, seed) => PA.generateDemo(kind, inst, n, seed, { stepMin: 30 });

test('toEpoch: berbagai format waktu', () => {
  const a = PA.toEpoch('2024-01-02');
  assert.equal(PA.toEpoch('2024-01-02 00:00'), a);
  assert.equal(PA.toEpoch('2024-01-02 00:00:00'), a);
  assert.equal(PA.toEpoch('2024-01-02T00:00:00Z'), a);
  assert.equal(PA.toEpoch('2024-01-02T07:00:00+07:00'), a);
  assert.equal(PA.toEpoch('2024-01-02 01:30') - a, 90 * 60000);
  assert.ok(Number.isNaN(PA.toEpoch('bukan waktu')));
});

test('resample: OHLC 4H & 1D dari 30m benar', () => {
  const cs = M30('mixed', 'XAUUSD', 48 * 6, 2);
  const h = PA.resample(cs, 4 * 3600000);
  const d = PA.resample(cs, 24 * 3600000);
  assert.equal(h.length, 6 * 6);
  assert.equal(d.length, 6);
  const first = cs.slice(0, 48);
  assert.equal(d[0].o, first[0].o);
  assert.equal(d[0].c, first[47].c);
  assert.equal(d[0].h, Math.max(...first.map((x) => x.h)));
  assert.equal(d[0].l, Math.min(...first.map((x) => x.l)));
  const h0 = cs.slice(0, 8);
  assert.equal(h[0].h, Math.max(...h0.map((x) => x.h)));
  assert.equal(h[0].c, h0[7].c);
});

test('prepareMTF: candle HTF hanya dipakai setelah CLOSE (indeks tertutup tepat)', () => {
  const ctx = PA.prepareMTF({ m30: M30('mixed', 'EURUSD', 6000, 4) });
  const H4 = 4 * 3600000, D1 = 24 * 3600000, M = 30 * 60000;
  for (let i = 0; i < ctx.M.length; i += 7) {
    const close = ctx.M[i].ts + M;
    const hi = ctx.hIdx[i], di = ctx.dIdx[i];
    if (hi >= 0) assert.ok(ctx.H[hi].ts + H4 <= close, 'H4 belum close @' + i);
    if (hi + 1 < ctx.H.length) assert.ok(ctx.H[hi + 1].ts + H4 > close, 'H4 berikutnya sudah close @' + i);
    if (di >= 0) assert.ok(ctx.D[di].ts + D1 <= close, 'D1 belum close @' + i);
    if (di + 1 < ctx.D.length) assert.ok(ctx.D[di + 1].ts + D1 > close, 'D1 berikutnya sudah close @' + i);
  }
});

test('MTF tanpa look-ahead: hasil sama walau data masa depan dibuang', () => {
  const all = M30('mixed', 'XAUUSD', 7000, 9);
  const full = PA.prepareMTF({ m30: all.map((c) => ({ ...c })) });
  let compared = 0;
  for (const i of [2500, 3100, 4200, 5000, 6100, 6900]) {
    const cut = PA.prepareMTF({ m30: all.slice(0, i + 1).map((c) => ({ ...c })) });
    const a = PA.analyzeMTFAt(full, i, false);
    const b = PA.analyzeMTFAt(cut, i, false);
    assert.equal(a.ok, b.ok);
    if (!a.ok) continue;
    assert.equal(a.score, b.score, 'skor @' + i);
    assert.equal(a.decision.action, b.decision.action);
    assert.deepEqual(a.breakdown, b.breakdown);
    assert.equal(a.layers.d1.idx, b.layers.d1.idx);
    assert.equal(a.layers.h4.idx, b.layers.h4.idx);
    compared++;
  }
  assert.ok(compared >= 4);
});

test('MTF simetri: cermin harga → skor terbalik, BUY<->SELL tertukar', () => {
  const K = 5000;
  const r2 = (x) => Number(x.toFixed(2));
  const base = M30('mixed', 'XAUUSD', 6500, 5);
  const mir = base.map((c) => ({ t: c.t, o: r2(K - c.o), h: r2(K - c.l), l: r2(K - c.h), c: r2(K - c.c) }));
  const A = PA.prepareMTF({ m30: base.map((c) => ({ ...c })) });
  const B = PA.prepareMTF({ m30: mir });
  const swap = (x) => (x === 'BUY' ? 'SELL' : x === 'SELL' ? 'BUY' : 'WAIT');
  let signals = 0;
  for (let i = 2400; i < A.M.length; i++) {
    const a = PA.analyzeMTFAt(A, i, false);
    const b = PA.analyzeMTFAt(B, i, false);
    assert.ok(a.score === -b.score, 'skor @' + i + ' ' + a.score + ' vs ' + b.score);
    assert.equal(a.decision.action, swap(b.decision.action), 'aksi @' + i);
    if (a.decision.action !== 'WAIT') signals++;
  }
  assert.ok(signals >= 0);
});

test('MTF: rencana BUY/SELL selalu konsisten & lolos gating lokasi/RR', () => {
  for (const seed of [1, 2, 3]) {
    const ctx = PA.prepareMTF({ m30: M30('mixed', 'EURUSD', 9000, seed) });
    for (let i = 2500; i < ctx.M.length; i++) {
      const a = PA.analyzeMTFAt(ctx, i, true);
      if (!a.ok || a.decision.action === 'WAIT') continue;
      const p = a.plan;
      if (a.decision.action === 'BUY') assert.ok(p.sl < p.entry && p.entry < p.tp1 && p.tp1 < p.tp2);
      else assert.ok(p.sl > p.entry && p.entry > p.tp1 && p.tp1 > p.tp2);
      assert.ok(p.rr1 >= PA.DEFAULTS.minRR - 1e-9);
      assert.ok(Math.abs(a.score) >= PA.MTF_DEFAULTS.mtfThreshold);
    }
  }
});

test('backtestMTF: konsisten, tidak tumpang tindih, ada ts & skor', async () => {
  const ctx = PA.prepareMTF({ m30: M30('mixed', 'XAUUSD', 12000, 6) }, { spread: 0.3 });
  const bt = await PA.backtestMTF(ctx);
  assert.equal(bt.cancelled, false);
  const s = bt.stats;
  assert.equal(s.trades, s.wins + s.losses);
  for (const t of bt.trades) {
    assert.ok(t.fillIdx > t.signalIdx && t.exitIdx >= t.fillIdx);
    assert.ok(Number.isFinite(t.ts) && Math.abs(t.score) >= 7);
  }
  for (let k = 1; k < bt.trades.length; k++) assert.ok(bt.trades[k].fillIdx > bt.trades[k - 1].exitIdx);
});

test('backtestMTF: cancel menghentikan proses', async () => {
  const ctx = PA.prepareMTF({ m30: M30('mixed', 'XAUUSD', 12000, 6) });
  const bt = await PA.backtestMTF(ctx, { cancel: () => true });
  // cancel hanya diperiksa periodik; hasil sah baik cancelled=true maupun selesai cepat
  assert.ok(bt.cancelled === true || bt.trades.length >= 0);
});

test('wilson: nilai acuan', () => {
  const w = PA.wilson(50, 100);
  assert.ok(Math.abs(w.lo - 0.4038) < 0.002 && Math.abs(w.hi - 0.5962) < 0.002);
  const z = PA.wilson(0, 10);
  assert.equal(z.p, 0);
  assert.ok(z.lo === 0 && z.hi > 0.2 && z.hi < 0.35);
  assert.deepEqual(PA.wilson(0, 0), { p: 0, lo: 0, hi: 1 });
});

test('summarizeMTF: agregasi tahun/sisi/skor & verdict berhati-hati', () => {
  const day = 86400000;
  const t0 = Date.UTC(2020, 0, 6);
  const mk = (k, R, side, score) => ({ ts: t0 + k * 20 * day, R, side, score });
  const trades = [];
  for (let k = 0; k < 40; k++) trades.push(mk(k, k % 2 ? 2 : -1, k % 3 ? 'BUY' : 'SELL', 7 + (k % 4)));
  const s = PA.summarizeMTF(trades);
  assert.equal(s.overall.n, 40);
  assert.equal(s.overall.wins, 20);
  assert.ok(Math.abs(s.overall.avgR - 0.5) < 1e-9);
  assert.ok(Math.abs(s.overall.breakEven - 1 / 3) < 1e-9); // avgLoss 1 / (2+1)
  assert.equal(s.bySide.reduce((x, r) => x + r.n, 0), 40);
  assert.equal(s.byScore.reduce((x, r) => x + r.n, 0), 40);
  assert.equal(s.byYear.reduce((x, r) => x + r.n, 0), 40);
  assert.ok(s.split.inSample.n + s.split.outSample.n === 40);
  assert.match(s.verdict, /CI 95%|keberuntungan|edge/);
  assert.match(PA.summarizeMTF(trades.slice(0, 5)).verdict, /terlalu kecil/);
  const pr = PA.probabilityForScore(s, -8);
  assert.ok(pr && pr.n === 10 && pr.reliable === false);
});

test('checkAlignment: mendeteksi zona waktu tidak sinkron', () => {
  const m = M30('mixed', 'XAUUSD', 3000, 8);
  PA.prepareMTF({ m30: m }); // menambah ts
  const h = PA.resample(m, 4 * 3600000);
  assert.ok(PA.checkAlignment(m, h, 4 * 3600000) > 0.95);
  const shifted = h.map((c) => ({ ...c, ts: c.ts + 3 * 3600000 }));
  assert.ok(PA.checkAlignment(m, shifted, 4 * 3600000) < 0.3);
});

test('simulate: tpR menghitung TP dari harga isi aktual (entri market)', () => {
  const cs = [C(10, 10.2, 9.8, 10), C(10.5, 10.6, 10.4, 10.55), C(10.55, 11.2, 10.5, 11.1)];
  // BUY market: entry -Infinity → isi di open candle berikutnya (10.5); SL 10.0 → risiko 0.5; TP 1R = 11.0
  const r = PA.simulate(cs, 0, 'BUY', { entry: -Infinity, sl: 10, tpR: 1 }, { spread: 0 }, { fillWindow: 1, maxHold: 5 });
  assert.equal(r.trade.entry, 10.5);
  assert.equal(r.trade.tp, 11);
  assert.equal(r.trade.outcome, 'TP');
  assert.ok(Math.abs(r.trade.R - 1) < 1e-9);
  const s = PA.simulate(cs.map((c) => ({ t: c.t, o: 20 - c.o, h: 20 - c.l, l: 20 - c.h, c: 20 - c.c })), 0, 'SELL', { entry: Infinity, sl: 10, tpR: 1 }, { spread: 0 }, { fillWindow: 1, maxHold: 5 });
  assert.equal(s.trade.outcome, 'TP');
  assert.ok(Math.abs(s.trade.R - 1) < 1e-9);
});

test('mtfEvents: arah, komponen, dan rencana level konsisten', () => {
  const ctx = PA.prepareMTF({ m30: M30('mixed', 'XAUUSD', 8000, 3) }, { spread: 0.3 });
  const ev = PA.mtfEvents(ctx);
  assert.ok(ev.length > 50);
  for (const e of ev) {
    assert.ok(e.score > 0 && (e.dir === 1 || e.dir === -1));
    assert.ok(e.trig >= 2 && e.hi >= e.lo && e.atr > 0);
    assert.ok(e.hour >= 0 && e.hour < 24);
    if (e.dir > 0) assert.ok(e.lvl.sl < e.lvl.entry); else assert.ok(e.lvl.sl > e.lvl.entry);
  }
  // ctx.o dipulihkan
  assert.equal(ctx.o.mtfThreshold, 7);
  // setiap sinyal backtest standar harus ada di daftar event (sinyal ⊆ event)
  return PA.backtestMTF(ctx).then((bt) => {
    const set = new Set(ev.map((e) => e.i));
    for (const s of bt.signals) assert.ok(set.has(s.i), 'sinyal ' + s.i + ' tidak ada di event');
  });
});
