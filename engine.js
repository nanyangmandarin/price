/*
 * Price Action Engine — analisis price action murni (tanpa dependensi).
 * Dipakai di browser (window.PA) dan Node (require) untuk pengujian.
 *
 * Konvensi: candle = { t, o, h, l, c } (t = label waktu string).
 * Semua analisis pada indeks i HANYA memakai candle <= i (tanpa look-ahead),
 * sehingga hasil backtest jujur terhadap apa yang terlihat saat itu.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Instrumen forex & gold                                              */
  /* ------------------------------------------------------------------ */
  // pipSize: 1 pip dalam satuan harga. contract: ukuran 1 lot standar.
  // pipValue: nilai 1 pip per 1 lot dalam USD (null = dihitung dari harga).
  // pipValueFn: hitung dari harga bila pipValue bergantung kurs.
  const INSTRUMENTS = {
    EURUSD: { name: 'EUR/USD', pipSize: 0.0001, contract: 100000, pipValue: 10, price: 1.085, vol: 0.0035, dp: 5 },
    GBPUSD: { name: 'GBP/USD', pipSize: 0.0001, contract: 100000, pipValue: 10, price: 1.27, vol: 0.004, dp: 5 },
    AUDUSD: { name: 'AUD/USD', pipSize: 0.0001, contract: 100000, pipValue: 10, price: 0.66, vol: 0.0035, dp: 5 },
    NZDUSD: { name: 'NZD/USD', pipSize: 0.0001, contract: 100000, pipValue: 10, price: 0.6, vol: 0.0035, dp: 5 },
    USDJPY: { name: 'USD/JPY', pipSize: 0.01, contract: 100000, pipValue: null, quote: 'JPY', price: 150, vol: 0.0038, dp: 3 },
    USDCHF: { name: 'USD/CHF', pipSize: 0.0001, contract: 100000, pipValue: null, quote: 'CHF', price: 0.88, vol: 0.0035, dp: 5 },
    USDCAD: { name: 'USD/CAD', pipSize: 0.0001, contract: 100000, pipValue: null, quote: 'CAD', price: 1.36, vol: 0.0033, dp: 5 },
    EURJPY: { name: 'EUR/JPY', pipSize: 0.01, contract: 100000, pipValue: 6.7, price: 163, vol: 0.0042, dp: 3 },
    GBPJPY: { name: 'GBP/JPY', pipSize: 0.01, contract: 100000, pipValue: 6.7, price: 190, vol: 0.0048, dp: 3 },
    XAUUSD: { name: 'Gold (XAU/USD)', pipSize: 0.1, contract: 100, pipValue: 10, price: 2650, vol: 0.0095, dp: 2 },
    CUSTOM: { name: 'Kustom', pipSize: 0.0001, contract: 100000, pipValue: 10, price: 1.0, vol: 0.004, dp: 5 },
  };

  // Nilai 1 pip per 1 lot (USD) untuk harga tertentu.
  function pipValueUSD(inst, price) {
    if (inst.pipValue != null) return inst.pipValue;
    // Pair "USD/XXX": nilai pip = (pipSize × contract) / harga
    return (inst.pipSize * inst.contract) / (price || inst.price);
  }

  /* ------------------------------------------------------------------ */
  /* Default parameter                                                   */
  /* ------------------------------------------------------------------ */
  const DEFAULTS = {
    minCandles: 30,
    lookback: 200,
    atrPeriod: 14,
    emaPeriod: 20,
    swingK: 3,
    srTolAtr: 0.5,
    minRR: 1.5,
    threshold: 6, // skor minimal (ketat 7 / normal 6 / longgar 5)
    slBufferAtr: 0.25,
    entryBufferAtr: 0.1,
    tpBufferAtr: 0.1,
    minRiskAtr: 0.5,
    maxRiskAtr: 3,
    spread: 0, // dalam satuan harga
    dp: null, // jumlah desimal untuk teks (null = 5)
  };

  /* ------------------------------------------------------------------ */
  /* Indikator                                                           */
  /* ------------------------------------------------------------------ */
  function computeIndicators(candles, opts) {
    const o = Object.assign({}, DEFAULTS, opts);
    const n = candles.length;
    const atr = new Array(n);
    const ema = new Array(n);
    const k = 2 / (o.emaPeriod + 1);
    let sumTr = 0;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const tr =
        i === 0
          ? c.h - c.l
          : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c));
      if (i < o.atrPeriod) {
        sumTr += tr;
        atr[i] = sumTr / (i + 1);
      } else {
        atr[i] = (atr[i - 1] * (o.atrPeriod - 1) + tr) / o.atrPeriod;
      }
      ema[i] = i === 0 ? c.c : c.c * k + ema[i - 1] * (1 - k);
    }
    return { atr, ema };
  }

  /* ------------------------------------------------------------------ */
  /* Swing high / low                                                    */
  /* ------------------------------------------------------------------ */
  function findSwings(candles, from, to, k) {
    const out = [];
    for (let j = Math.max(from, k); j <= to - k; j++) {
      const h = candles[j].h;
      const l = candles[j].l;
      let isH = true;
      let isL = true;
      for (let m = 1; m <= k; m++) {
        if (candles[j - m].h >= h || candles[j + m].h > h) isH = false;
        if (candles[j - m].l <= l || candles[j + m].l < l) isL = false;
      }
      if (isH) out.push({ i: j, type: 'H', price: h });
      if (isL) out.push({ i: j, type: 'L', price: l });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Struktur pasar                                                      */
  /* ------------------------------------------------------------------ */
  function marketStructure(swings, candles, i) {
    const H = swings.filter((s) => s.type === 'H');
    const L = swings.filter((s) => s.type === 'L');
    const res = {
      trend: 'unknown',
      label: 'Swing belum cukup untuk membaca struktur',
      lastHigh: H[H.length - 1] || null,
      lastLow: L[L.length - 1] || null,
      prevHigh: H[H.length - 2] || null,
      prevLow: L[L.length - 2] || null,
      bos: null,
    };
    if (H.length < 2 || L.length < 2) return res;

    const hh = res.lastHigh.price > res.prevHigh.price;
    const lh = res.lastHigh.price < res.prevHigh.price;
    const hl = res.lastLow.price > res.prevLow.price;
    const ll = res.lastLow.price < res.prevLow.price;

    if (hh && hl) {
      res.trend = 'up';
      res.label = 'Uptrend (Higher High & Higher Low)';
    } else if (lh && ll) {
      res.trend = 'down';
      res.label = 'Downtrend (Lower High & Lower Low)';
    } else {
      res.trend = 'range';
      res.label = hh && ll ? 'Sideways melebar (HH & LL)' : lh && hl ? 'Sideways menyempit (LH & HL)' : 'Sideways';
    }

    // Break of Structure / Change of Character (baru saja terjadi)
    const cl = candles[i].c;
    const prev = candles.slice(Math.max(0, i - 3), i);
    if (cl > res.lastHigh.price && prev.some((x) => x.c <= res.lastHigh.price)) {
      res.bos = { dir: 'bull', kind: res.trend === 'down' ? 'CHoCH' : 'BOS', level: res.lastHigh.price };
    } else if (cl < res.lastLow.price && prev.some((x) => x.c >= res.lastLow.price)) {
      res.bos = { dir: 'bear', kind: res.trend === 'up' ? 'CHoCH' : 'BOS', level: res.lastLow.price };
    }
    return res;
  }

  /* ------------------------------------------------------------------ */
  /* Support / Resistance dari klaster swing                             */
  /* ------------------------------------------------------------------ */
  function buildLevels(swings, price, tol) {
    // Klaster berbasis kepadatan: titik dengan tetangga (±tol) terbanyak dipilih lebih dulu;
    // seri dipecah menurut waktu (lebih baru menang), bukan harga → hasil simetris BUY/SELL.
    const pts = swings.map((s) => ({ p: s.price, i: s.i, used: false }));
    const levels = [];
    for (;;) {
      let best = null;
      let bestN = 0;
      for (const a of pts) {
        if (a.used) continue;
        let n = 0;
        for (const b of pts) if (!b.used && Math.abs(b.p - a.p) <= tol) n++;
        if (n > bestN || (n === bestN && best && a.i > best.i)) { best = a; bestN = n; }
      }
      if (!best) break;
      const mem = pts.filter((b) => !b.used && Math.abs(b.p - best.p) <= tol);
      mem.forEach((m) => { m.used = true; });
      const price0 = mem.reduce((x, m) => x + m.p, 0) / mem.length;
      levels.push({
        price: price0,
        touches: mem.length,
        lastIdx: Math.max.apply(null, mem.map((m) => m.i)),
        lo: Math.min.apply(null, mem.map((m) => m.p)),
        hi: Math.max.apply(null, mem.map((m) => m.p)),
        kind: price0 <= price ? 'support' : 'resistance',
        strength: mem.length >= 3 ? 'kuat' : mem.length === 2 ? 'sedang' : 'lemah',
      });
    }
    return levels.sort((x, y) => x.price - y.price);
  }

  /* ------------------------------------------------------------------ */
  /* Pola candle                                                         */
  /* ------------------------------------------------------------------ */
  function metrics(c) {
    const range = c.h - c.l;
    const body = Math.abs(c.c - c.o);
    return {
      range,
      body,
      up: c.h - Math.max(c.o, c.c),
      lo: Math.min(c.o, c.c) - c.l,
      bull: c.c > c.o,
      bear: c.c < c.o,
    };
  }

  const isInside = (c, mother) => c.h < mother.h && c.l > mother.l;

  // Mengembalikan semua pola yang SELESAI pada candle ke-i.
  function detectPatterns(candles, i, atr) {
    const out = [];
    const c = candles[i];
    const m = metrics(c);
    if (!(m.range > 0) || !(atr > 0)) return out;
    const p = i >= 1 ? candles[i - 1] : null;
    const pm = p ? metrics(p) : null;
    const add = (key, name, bias, quality, span, desc) => out.push({ key, name, bias, quality, span, i, desc });

    // Pin bar
    if (m.range >= 0.5 * atr) {
      const body = m.body / m.range;
      const lo = m.lo / m.range;
      const up = m.up / m.range;
      if (lo >= 0.6 && up <= 0.2 && body <= 0.35) {
        const swept = p && c.l < p.l;
        add('pinbar', 'Pin Bar Bullish', 'bull', swept ? 3 : 2, 1,
          'Ekor bawah panjang: harga rendah ditolak pembeli' + (swept ? ' (sekaligus menyapu low sebelumnya)' : ''));
      } else if (up >= 0.6 && lo <= 0.2 && body <= 0.35) {
        const swept = p && c.h > p.h;
        add('pinbar', 'Pin Bar Bearish', 'bear', swept ? 3 : 2, 1,
          'Ekor atas panjang: harga tinggi ditolak penjual' + (swept ? ' (sekaligus menyapu high sebelumnya)' : ''));
      }
    }

    // Engulfing
    if (p && pm.body >= 0.15 * atr && m.body >= 0.4 * atr && m.body > pm.body) {
      if (pm.bear && m.bull && c.c >= p.o && c.o <= p.c) {
        const outside = c.h >= p.h && c.l <= p.l;
        add('engulfing', 'Bullish Engulfing', 'bull', outside ? 3 : 2, 2, 'Body bullish menelan body bearish sebelumnya');
      } else if (pm.bull && m.bear && c.c <= p.o && c.o >= p.c) {
        const outside = c.h >= p.h && c.l <= p.l;
        add('engulfing', 'Bearish Engulfing', 'bear', outside ? 3 : 2, 2, 'Body bearish menelan body bullish sebelumnya');
      }
    }

    // Inside bar & breakout-nya
    if (p && isInside(c, p)) {
      add('insidebar', 'Inside Bar', 'neutral', 1, 2, 'Konsolidasi di dalam range candle sebelumnya — tunggu breakout');
    }
    if (i >= 2) {
      const mother = candles[i - 2];
      if (isInside(candles[i - 1], mother)) {
        const strong = m.range > 0 && m.body / m.range >= 0.5;
        if (c.c > mother.h) add('ibbreak', 'Inside Bar Breakout ↑', 'bull', strong ? 3 : 2, 3, 'Close menembus high candle induk setelah konsolidasi');
        else if (c.c < mother.l) add('ibbreak', 'Inside Bar Breakout ↓', 'bear', strong ? 3 : 2, 3, 'Close menembus low candle induk setelah konsolidasi');
      }
    }

    // Doji
    if (m.body / m.range <= 0.1 && m.range >= 0.3 * atr) {
      add('doji', 'Doji', 'neutral', 1, 1, 'Keraguan pasar — body sangat kecil');
    }

    // Morning / Evening star
    if (i >= 2) {
      const a = candles[i - 2];
      const b = candles[i - 1];
      const ma = metrics(a);
      const mb = metrics(b);
      if (ma.range > 0 && ma.body >= 0.6 * atr && ma.body / ma.range >= 0.5 && mb.body <= 0.35 * ma.body && m.body >= 0.4 * atr) {
        const mid = (a.o + a.c) / 2;
        if (ma.bear && m.bull && c.c > mid) add('star', 'Morning Star', 'bull', 3, 3, 'Tiga candle pembalikan naik: turun kuat → ragu → naik kuat');
        else if (ma.bull && m.bear && c.c < mid) add('star', 'Evening Star', 'bear', 3, 3, 'Tiga candle pembalikan turun: naik kuat → ragu → turun kuat');
      }
    }

    // Candle momentum (marubozu)
    if (m.body / m.range >= 0.8 && m.body >= 1.2 * atr) {
      if (m.bull) add('momentum', 'Momentum Bullish', 'bull', 1, 1, 'Candle besar nyaris tanpa ekor — pembeli dominan');
      else if (m.bear) add('momentum', 'Momentum Bearish', 'bear', 1, 1, 'Candle besar nyaris tanpa ekor — penjual dominan');
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Rencana trade                                                       */
  /* ------------------------------------------------------------------ */
  function buildPlan(side, candles, i, sig, atr, levels, o) {
    const dir = side === 'BUY' ? 1 : -1;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - sig.span + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].h);
      lo = Math.min(lo, candles[j].l);
    }
    const entry = dir > 0 ? hi + o.entryBufferAtr * atr : lo - o.entryBufferAtr * atr;
    let sl = dir > 0 ? lo - o.slBufferAtr * atr : hi + o.slBufferAtr * atr;
    let risk = Math.abs(entry - sl);
    const notes = [];
    if (risk < o.minRiskAtr * atr) {
      risk = o.minRiskAtr * atr;
      sl = entry - dir * risk;
      notes.push('SL diperlebar ke 0,5×ATR agar tidak mudah tersapu noise.');
    }
    const tooWide = risk > o.maxRiskAtr * atr;

    const ahead = levels
      .filter((l) => (dir > 0 ? l.price > entry + 0.25 * atr : l.price < entry - 0.25 * atr))
      .sort((a, b) => (dir > 0 ? a.price - b.price : b.price - a.price));
    const rrOf = (price) => Math.abs(price - entry) / risk;
    const blocker = ahead[0] || null;
    const tp1 = blocker ? blocker.price - dir * o.tpBufferAtr * atr : entry + dir * 2 * risk;
    const rr1 = rrOf(tp1);
    const next = ahead.find((l) => rrOf(l.price) >= rr1 + 0.5);
    const tp2 = next ? next.price - dir * o.tpBufferAtr * atr : entry + dir * Math.max(3, rr1 + 1) * risk;
    if (!blocker) notes.push('Tidak ada level di depan harga (ruang terbuka) — TP memakai kelipatan risiko.');

    // Spread: BUY masuk di ask (+spread), SL/TP di bid; SELL sebaliknya.
    const spread = o.spread || 0;
    const effRisk = risk + spread;
    return {
      side, entry, sl, tp1, tp2, risk, effRisk, spread,
      rr1: Math.abs(tp1 - entry) / effRisk,
      rr2: Math.abs(tp2 - entry) / effRisk,
      blocker, tooWide, notes,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Analisis utama pada indeks i                                        */
  /* ------------------------------------------------------------------ */
  function analyzeAt(candles, i, opts, ind) {
    const o = Object.assign({}, DEFAULTS, opts);
    if (i + 1 < o.minCandles) {
      return { ok: false, error: 'Butuh minimal ' + o.minCandles + ' candle untuk analisis (saat ini ' + (i + 1) + ').' };
    }
    ind = ind || computeIndicators(candles, o);
    const fp = (x) => x.toFixed(o.dp != null ? o.dp : 5);
    const c = candles[i];
    const atr = Math.max(ind.atr[i], Math.abs(c.c) * 1e-9, 1e-12);
    const ema = ind.ema[i];
    const emaSlope = ema - ind.ema[Math.max(0, i - 3)];
    const from = Math.max(0, i - o.lookback + 1);
    const swings = findSwings(candles, from, i, o.swingK);
    const structure = marketStructure(swings, candles, i);
    const tol = atr * o.srTolAtr;
    const levels = buildLevels(swings, c.c, tol);
    const patterns = detectPatterns(candles, i, atr);

    const bestBull = patterns.filter((p) => p.bias === 'bull').sort((a, b) => b.quality - a.quality)[0] || null;
    const bestBear = patterns.filter((p) => p.bias === 'bear').sort((a, b) => b.quality - a.quality)[0] || null;

    /* ---- Skor (positif = bullish) ---- */
    const breakdown = [];
    const add = (label, pts, note) => breakdown.push({ label, pts, note });
    let S = 0;

    // 1. Tren
    if (structure.trend === 'up') { S += 2; add('Struktur', 2, structure.label); }
    else if (structure.trend === 'down') { S -= 2; add('Struktur', -2, structure.label); }
    else add('Struktur', 0, structure.label);

    // 2. EMA
    if (c.c > ema && emaSlope > 0) { S += 1; add('EMA ' + o.emaPeriod, 1, 'Harga di atas EMA yang naik'); }
    else if (c.c < ema && emaSlope < 0) { S -= 1; add('EMA ' + o.emaPeriod, -1, 'Harga di bawah EMA yang turun'); }
    else add('EMA ' + o.emaPeriod, 0, 'Harga dan kemiringan EMA tidak searah');

    // 3. Pola candle
    const bullQ = bestBull ? bestBull.quality : 0;
    const bearQ = bestBear ? bestBear.quality : 0;
    if (bullQ || bearQ) {
      S += bullQ - bearQ;
      const names = [bestBull && bestBull.name, bestBear && bestBear.name].filter(Boolean).join(' vs ');
      add('Pola candle', bullQ - bearQ, names);
    } else add('Pola candle', 0, 'Tidak ada pola pemicu pada candle terakhir');

    // 4. Lokasi (di S/R)
    const spanLow = (sig) => Math.min.apply(null, candles.slice(i - sig.span + 1, i + 1).map((x) => x.l));
    const spanHigh = (sig) => Math.max.apply(null, candles.slice(i - sig.span + 1, i + 1).map((x) => x.h));
    let locPts = 0;
    let locNote = 'Harga tidak berada di area S/R yang jelas';
    const sigForLoc = bestBull || bestBear;
    const lo = sigForLoc ? spanLow(sigForLoc) : c.l;
    const hi = sigForLoc ? spanHigh(sigForLoc) : c.h;
    const sup = levels
      .filter((l) => l.price <= c.c + tol && lo <= l.price + 0.75 * atr && lo >= l.price - 1.5 * atr)
      .sort((a, b) => b.touches - a.touches)[0];
    const res = levels
      .filter((l) => l.price >= c.c - tol && hi >= l.price - 0.75 * atr && hi <= l.price + 1.5 * atr)
      .sort((a, b) => b.touches - a.touches)[0];
    if (sup && !res) { locPts = sup.touches >= 3 ? 3 : 2; locNote = 'Di area support ' + fp(sup.price) + ' (' + sup.touches + '× disentuh)'; }
    else if (res && !sup) { locPts = res.touches >= 3 ? -3 : -2; locNote = 'Di area resistance ' + fp(res.price) + ' (' + res.touches + '× disentuh)'; }
    S += locPts;
    add('Lokasi', locPts, locNote);

    // 5. BOS / CHoCH
    if (structure.bos) {
      const pts = structure.bos.dir === 'bull' ? 1 : -1;
      S += pts;
      add(structure.bos.kind, pts, 'Close menembus swing ' + (pts > 0 ? 'high' : 'low') + ' terakhir');
    } else add('BOS/CHoCH', 0, 'Belum ada break struktur baru');

    /* ---- Keputusan ---- */
    const warnings = [];
    const reasons = [];
    let action = 'WAIT';
    let plan = null;
    let sigUsed = null;

    const r = c.h - c.l;
    if (r > 2.5 * atr) warnings.push('Candle terakhir sangat besar (' + (r / atr).toFixed(1) + '× ATR) — volatilitas tinggi, spread/slippage bisa melebar.');
    if (i + 1 < 60) warnings.push('Data pendek (' + (i + 1) + ' candle) — struktur & level kurang andal.');

    const wantBuy = S >= o.threshold;
    const wantSell = S <= -o.threshold;
    if (wantBuy || wantSell) {
      const side = wantBuy ? 'BUY' : 'SELL';
      const sig = wantBuy ? bestBull : bestBear;
      if (!sig || sig.quality < 2) {
        reasons.push('Bias ' + (wantBuy ? 'bullish' : 'bearish') + ' kuat, tetapi belum ada candle pemicu (pin bar / engulfing / star / inside bar breakout). Tunggu konfirmasi.');
      } else {
        const p = buildPlan(side, candles, i, sig, atr, levels, o);
        if (p.tooWide) {
          reasons.push('Stop loss terlalu jauh (' + (p.risk / atr).toFixed(1) + '× ATR) — posisi tidak efisien. Tunggu setup dengan SL lebih ketat.');
        } else if (p.rr1 < o.minRR) {
          reasons.push('Ruang ke ' + (wantBuy ? 'resistance' : 'support') + ' terdekat terlalu sempit (RR ' + p.rr1.toFixed(2) + ' < ' + o.minRR + ').');
          plan = null;
        } else {
          action = side;
          plan = p;
          sigUsed = sig;
          const counter = (wantBuy && structure.trend === 'down') || (wantSell && structure.trend === 'up');
          if (counter) warnings.push('Setup counter-trend (melawan struktur sebelumnya) — risiko lebih tinggi, pertimbangkan lot lebih kecil.');
          p.notes.forEach((n) => warnings.push(n));
        }
      }
    } else if (Math.abs(S) >= 3) {
      reasons.push('Bias ' + (S > 0 ? 'bullish' : 'bearish') + ' (skor ' + S + ') belum cukup kuat untuk entri — butuh skor ≥ ' + o.threshold + '.');
    } else {
      reasons.push('Tidak ada konfluensi yang jelas (skor ' + S + ') — lebih baik menunggu.');
    }

    /* ---- Skenario pengamatan untuk WAIT ---- */
    const watch = [];
    if (action === 'WAIT') {
      const supBelow = levels.filter((l) => l.price < c.c - 0.25 * atr).sort((a, b) => b.price - a.price)[0];
      const resAbove = levels.filter((l) => l.price > c.c + 0.25 * atr).sort((a, b) => a.price - b.price)[0];
      if (structure.trend === 'up') {
        watch.push(supBelow ? 'Tunggu pullback ke support ' + fp(supBelow.price) + ', cari pin bar / bullish engulfing untuk BUY.' : 'Tunggu pullback lalu candle bullish pemicu untuk BUY.');
      } else if (structure.trend === 'down') {
        watch.push(resAbove ? 'Tunggu pullback ke resistance ' + fp(resAbove.price) + ', cari pin bar / bearish engulfing untuk SELL.' : 'Tunggu pullback lalu candle bearish pemicu untuk SELL.');
      } else {
        if (supBelow) watch.push('Area BUY: dekat support ' + fp(supBelow.price) + ' dengan sinyal bullish.');
        if (resAbove) watch.push('Area SELL: dekat resistance ' + fp(resAbove.price) + ' dengan sinyal bearish.');
        watch.push('Hindari entri di tengah range.');
      }
      if (patterns.some((p) => p.key === 'insidebar')) watch.push('Inside bar terbentuk — tunggu close menembus high (BUY) atau low (SELL) candle induk.');
    }

    const confidence = Math.abs(S) >= 8 ? 'Tinggi' : Math.abs(S) >= 6 ? 'Sedang' : 'Rendah';
    let summary;
    if (action === 'WAIT') summary = 'WAIT — ' + reasons[0];
    else {
      summary = action + ' — ' + sigUsed.name + ' pada ' + structure.label.toLowerCase() + '; RR ke TP1 = ' + plan.rr1.toFixed(2) + '.';
    }

    return {
      ok: true,
      i, time: c.t, price: c.c, atr, ema,
      score: S, breakdown, structure, levels, swings, patterns,
      decision: { action, confidence, summary, reasons, warnings, watch, signal: sigUsed },
      plan,
    };
  }

  function analyze(candles, opts) {
    return analyzeAt(candles, candles.length - 1, opts, null);
  }

  /* ------------------------------------------------------------------ */
  /* Backtest (walk-forward, tanpa look-ahead)                           */
  /* ------------------------------------------------------------------ */
  function backtest(candles, opts, cfg) {
    const o = Object.assign({}, DEFAULTS, opts);
    const c2 = Object.assign({ maxCandles: 1500, fillWindow: 3, maxHold: 30 }, cfg);
    const n = candles.length;
    const ind = computeIndicators(candles, o);
    const startAt = Math.max(o.minCandles, n - c2.maxCandles);
    const trades = [];
    const signals = [];
    let i = startAt;

    while (i < n - 1) {
      const a = analyzeAt(candles, i, o, ind);
      if (!a.ok || a.decision.action === 'WAIT') { i++; continue; }
      const side = a.decision.action;
      const dir = side === 'BUY' ? 1 : -1;
      const { entry, sl, tp1 } = a.plan;
      signals.push({ i, side });

      // 1) tunggu entry stop terpicu dalam jendela fillWindow
      let fillIdx = -1;
      let fillPx = 0;
      for (let j = i + 1; j <= Math.min(n - 1, i + c2.fillWindow); j++) {
        const cj = candles[j];
        const trig = dir > 0 ? cj.h >= entry : cj.l <= entry;
        if (trig) {
          fillIdx = j;
          fillPx = dir > 0 ? Math.max(entry, cj.o) : Math.min(entry, cj.o);
          break;
        }
        // setup batal bila SL tersentuh sebelum entri
        if (dir > 0 ? cj.l <= sl : cj.h >= sl) break;
      }
      if (fillIdx < 0) { i++; continue; }

      const risk = dir * (fillPx - sl);
      if (!(risk > 0)) { i = fillIdx + 1; continue; }

      // 2) kelola posisi: SL dulu bila SL & TP di candle yang sama (konservatif)
      let exitIdx = -1;
      let exitPx = 0;
      let outcome = '';
      for (let j = fillIdx; j <= Math.min(n - 1, fillIdx + c2.maxHold); j++) {
        const cj = candles[j];
        const first = j === fillIdx;
        const hitSL = dir > 0 ? cj.l <= sl : cj.h >= sl;
        const hitTP = dir > 0 ? cj.h >= tp1 : cj.l <= tp1;
        if (!first && (dir > 0 ? cj.o <= sl : cj.o >= sl)) { exitIdx = j; exitPx = cj.o; outcome = 'SL'; break; }
        if (hitSL) { exitIdx = j; exitPx = sl; outcome = 'SL'; break; }
        if (!first && (dir > 0 ? cj.o >= tp1 : cj.o <= tp1)) { exitIdx = j; exitPx = cj.o; outcome = 'TP'; break; }
        if (hitTP) { exitIdx = j; exitPx = tp1; outcome = 'TP'; break; }
      }
      if (exitIdx < 0) {
        exitIdx = Math.min(n - 1, fillIdx + c2.maxHold);
        exitPx = candles[exitIdx].c;
        outcome = 'Waktu';
      }
      const gross = dir * (exitPx - fillPx);
      const R = (gross - o.spread) / (risk + o.spread);
      trades.push({ signalIdx: i, fillIdx, exitIdx, side, entry: fillPx, exit: exitPx, sl, tp: tp1, R, outcome });
      i = exitIdx + 1;
    }

    return { trades, signals, stats: tradeStats(trades), startAt };
  }

  function tradeStats(trades) {
    const n = trades.length;
    const wins = trades.filter((t) => t.R > 0);
    const losses = trades.filter((t) => t.R <= 0);
    const sumW = wins.reduce((s, t) => s + t.R, 0);
    const sumL = Math.abs(losses.reduce((s, t) => s + t.R, 0));
    let cum = 0;
    let peak = 0;
    let maxDD = 0;
    const equity = [0];
    for (const t of trades) {
      cum += t.R;
      equity.push(cum);
      peak = Math.max(peak, cum);
      maxDD = Math.max(maxDD, peak - cum);
    }
    return {
      trades: n,
      wins: wins.length,
      losses: losses.length,
      winRate: n ? wins.length / n : 0,
      avgR: n ? cum / n : 0,
      totalR: cum,
      profitFactor: sumL > 0 ? sumW / sumL : n && sumW > 0 ? Infinity : 0,
      maxDD,
      equity,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Ukuran posisi (lot) untuk forex / gold                              */
  /* ------------------------------------------------------------------ */
  function positionSize(p) {
    const risk$ = (p.balance * p.riskPct) / 100;
    const dist = Math.abs(p.entry - p.sl) + (p.spread || 0);
    if (!(risk$ > 0) || !(dist > 0) || !(p.pipSize > 0) || !(p.pipValue > 0)) return null;
    const slPips = dist / p.pipSize;
    const rawLots = risk$ / (slPips * p.pipValue);
    const lots = Math.floor(rawLots * 100 + 1e-9) / 100; // turun ke 0.01 lot
    const real$ = lots * slPips * p.pipValue;
    const pips = (price) => Math.abs(price - p.entry) / p.pipSize;
    return {
      riskAmount: risk$, slPips, lots, rawLots, realRisk: real$,
      tp1Pips: p.tp1 != null ? pips(p.tp1) : null,
      tp2Pips: p.tp2 != null ? pips(p.tp2) : null,
      tp1Profit: p.tp1 != null ? lots * (pips(p.tp1) - (p.spread || 0) / p.pipSize) * p.pipValue : null,
      tp2Profit: p.tp2 != null ? lots * (pips(p.tp2) - (p.spread || 0) / p.pipSize) * p.pipValue : null,
      belowMinLot: lots < 0.01,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Impor CSV (TradingView, MT4/MT5, Dukascopy, Yahoo, dll.)            */
  /* ------------------------------------------------------------------ */
  function parseCSV(text) {
    const warnings = [];
    const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) throw new Error('Data kosong atau terlalu sedikit baris.');
    const first = lines[0];
    const delim = first.includes('\t') ? '\t' : first.includes(';') ? ';' : first.includes(',') ? ',' : /\s+/;
    const split = (l) => l.split(delim).map((x) => x.trim().replace(/^"|"$/g, ''));
    const num = (s) => {
      if (s == null || s === '') return NaN;
      let t = String(s);
      if (delim === ';' && t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
      return Number(t);
    };

    let rows = lines.map(split);
    let idx = { t: -1, d: -1, tm: -1, o: -1, h: -1, l: -1, c: -1 };
    const headerLike = rows[0].some((x) => /[a-z]/i.test(x)) && rows[0].slice(1).some((x) => /^[<]?(open|high|low|close|o|h|l|c|date|time)[>]?$/i.test(x) || /open|high|low|close/i.test(x));
    if (headerLike) {
      const head = rows[0].map((x) => x.toLowerCase().replace(/[<>"]/g, '').trim());
      head.forEach((name, k) => {
        if (/^(date|tanggal)$/.test(name)) idx.d = k;
        else if (/^(time|waktu)$/.test(name)) idx.tm = k;
        else if (/^(datetime|timestamp|gmt time|local time|date\/time)$/.test(name)) idx.t = k;
        else if (/^(open|o)$/.test(name)) idx.o = k;
        else if (/^(high|h)$/.test(name)) idx.h = k;
        else if (/^(low|l)$/.test(name)) idx.l = k;
        else if (/^(close|c|last)$/.test(name)) idx.c = k;
      });
      rows = rows.slice(1);
      if (idx.t < 0 && idx.d >= 0 && idx.tm < 0) idx.t = idx.d;
      if (idx.t < 0 && idx.d < 0) idx.t = 0;
    } else {
      const w = rows[0].length;
      // MT4 History Center: tanggal, jam, O, H, L, C, volume (kolom ke-2 berformat jam)
      if (w >= 6 && /^\d{1,2}:\d{2}(:\d{2})?$/.test(rows[0][1])) idx = { t: -1, d: 0, tm: 1, o: 2, h: 3, l: 4, c: 5 };
      else if (w >= 5) idx = { t: 0, d: -1, tm: -1, o: 1, h: 2, l: 3, c: 4 };
      else if (w === 4) idx = { t: -1, d: -1, tm: -1, o: 0, h: 1, l: 2, c: 3 };
      else throw new Error('Format tidak dikenali. Butuh kolom: waktu, open, high, low, close.');
    }
    if (idx.o < 0 || idx.h < 0 || idx.l < 0 || idx.c < 0) {
      throw new Error('Kolom Open/High/Low/Close tidak ditemukan pada header.');
    }

    const candles = [];
    let fixed = 0;
    let skipped = 0;
    rows.forEach((r, k) => {
      const o = num(r[idx.o]);
      let h = num(r[idx.h]);
      let l = num(r[idx.l]);
      const c = num(r[idx.c]);
      if (![o, h, l, c].every(Number.isFinite)) { skipped++; return; }
      if (h < Math.max(o, c) || l > Math.min(o, c)) {
        h = Math.max(h, o, c);
        l = Math.min(l, o, c);
        fixed++;
      }
      if (h < l) { skipped++; return; }
      let t = '';
      if (idx.d >= 0 && idx.tm >= 0) t = r[idx.d] + ' ' + r[idx.tm];
      else if (idx.t >= 0) t = r[idx.t];
      else t = String(k + 1);
      candles.push({ t: normalizeTime(t), o, h, l, c });
    });
    if (candles.length < 2) throw new Error('Tidak ada baris valid yang bisa dibaca.');
    if (skipped) warnings.push(skipped + ' baris dilewati (tidak valid).');
    if (fixed) warnings.push(fixed + ' candle diperbaiki (High/Low tidak konsisten dengan Open/Close).');

    // Urutan: pastikan lama → baru
    const a = Date.parse(isoish(candles[0].t));
    const b = Date.parse(isoish(candles[candles.length - 1].t));
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
      candles.reverse();
      warnings.push('Urutan data dibalik (terbaru → terlama) menjadi lama → baru.');
    }
    return { candles, warnings };
  }

  function isoish(t) {
    return String(t).replace(/\./g, '-').replace(' ', 'T');
  }

  function normalizeTime(t) {
    const s = String(t).trim();
    if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString().slice(0, 16).replace('T', ' ');
    if (/^\d{13}$/.test(s)) return new Date(Number(s)).toISOString().slice(0, 16).replace('T', ' ');
    return s.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3');
  }

  function inferPrecision(candles) {
    let dp = 0;
    for (const c of candles.slice(-60)) {
      const s = String(c.c);
      const k = s.indexOf('.');
      if (k >= 0) dp = Math.max(dp, s.length - k - 1);
    }
    return Math.min(Math.max(dp, 2), 6);
  }

  /* ------------------------------------------------------------------ */
  /* Data contoh sintetis (bukan data pasar nyata)                       */
  /* ------------------------------------------------------------------ */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateDemo(kind, instId, n, seed) {
    const inst = INSTRUMENTS[instId] || INSTRUMENTS.EURUSD;
    n = n || 260;
    const rnd = mulberry32(seed == null ? 7 : seed);
    const gauss = () => {
      let u = 0;
      let v = 0;
      while (!u) u = rnd();
      while (!v) v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const vol = inst.vol;
    const plans = {
      up: [['trend', 1], ['pull', 1]],
      down: [['trend', -1], ['pull', -1]],
      range: [['range', 0]],
      mixed: [['trend', 1], ['pull', 1], ['range', 0], ['trend', -1], ['pull', -1], ['range', 0]],
    };
    const plan = plans[kind] || plans.mixed;
    const segs = [];
    let total = 0;
    let pi = 0;
    while (total < n) {
      const [type, d] = plan[pi % plan.length];
      let len = type === 'trend' ? 22 + Math.floor(rnd() * 20) : type === 'pull' ? 7 + Math.floor(rnd() * 8) : 45 + Math.floor(rnd() * 30);
      segs.push({ type, d, len });
      total += len;
      pi++;
    }

    const out = [];
    let px = inst.price;
    let mu = px;
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    // mundur n hari kerja
    let back = n;
    while (back > 0) {
      date.setUTCDate(date.getUTCDate() - 1);
      if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) back--;
    }
    const nextDate = () => {
      do date.setUTCDate(date.getUTCDate() + 1); while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
      return date.toISOString().slice(0, 10);
    };
    const dp = inst.dp;
    const round = (x) => Number(x.toFixed(dp));

    outer: for (const s of segs) {
      if (s.type === 'range') mu = px;
      for (let k = 0; k < s.len; k++) {
        if (out.length >= n) break outer;
        let drift = 0;
        if (s.type === 'trend') drift = s.d * vol * 0.28;
        else if (s.type === 'pull') drift = -s.d * vol * 0.22;
        else drift = -0.12 * ((px - mu) / px);
        const o = px * (1 + 0.08 * vol * gauss());
        const cc = o * (1 + drift + vol * 0.75 * gauss());
        const fat = () => (rnd() < 0.18 ? 2.6 : 1);
        const hi = Math.max(o, cc) + Math.abs(gauss()) * vol * 0.55 * px * fat();
        const lo = Math.min(o, cc) - Math.abs(gauss()) * vol * 0.55 * px * fat();
        out.push({ t: nextDate(), o: round(o), h: round(hi), l: round(lo), c: round(cc) });
        px = cc;
      }
    }
    return out;
  }

  return {
    DEFAULTS, INSTRUMENTS,
    computeIndicators, findSwings, marketStructure, buildLevels, detectPatterns, buildPlan,
    analyze, analyzeAt, backtest, tradeStats, positionSize, pipValueUSD,
    parseCSV, inferPrecision, generateDemo,
  };
});
