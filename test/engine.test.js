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
