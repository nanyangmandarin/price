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
  // Lintasan harga di dalam satu candle (heuristik standar): candle naik O→L→H→C, candle turun O→H→L→C.
  function barPath(c) {
    return c.c >= c.o ? [c.o, c.l, c.h, c.c] : [c.o, c.h, c.l, c.c];
  }
  // Telusuri lintasan dari harga `from` menuju pts[seg..]; kembalikan sentuhan SL/TP pertama ({hit, px}) atau null.
  function scanPath(pts, seg, from, dir, sl, tp) {
    let cur = from;
    for (let s = seg; s < pts.length; s++) {
      const nxt = pts[s];
      if (nxt < cur) {
        if (dir > 0 && nxt <= sl) return { hit: 'SL', px: Math.min(cur, sl) };
        if (dir < 0 && tp != null && nxt <= tp) return { hit: 'TP', px: Math.min(cur, tp) };
      } else if (nxt > cur) {
        if (dir > 0 && tp != null && nxt >= tp) return { hit: 'TP', px: Math.max(cur, tp) };
        if (dir < 0 && nxt >= sl) return { hit: 'SL', px: Math.max(cur, sl) };
      }
      cur = nxt;
    }
    return null;
  }
  // Mode konservatif: bila SL tersentuh di candle, dianggap kena lebih dulu (batas bawah hasil).
  function consBar(c, dir, sl, tp) {
    if (dir > 0 ? c.l <= sl : c.h >= sl) return { hit: 'SL', px: sl };
    if (tp != null && (dir > 0 ? c.h >= tp : c.l <= tp)) return { hit: 'TP', px: tp };
    return null;
  }
  // Kelola posisi terbuka mulai candle setelah j0 sampai lastIdx (inklusif). Kembalikan {exitIdx, exitPx, outcome}.
  // mode 'conservative' (default, batas bawah) atau 'path' (lintasan O→L→H→C / O→H→L→C, cenderung optimis untuk entri stop).
  function manageFrom(candles, j0, lastIdx, dir, sl, tp, mode) {
    for (let j = j0 + 1; j <= lastIdx; j++) {
      const c = candles[j];
      if (dir > 0 ? c.o <= sl : c.o >= sl) return { exitIdx: j, exitPx: c.o, outcome: 'SL' };
      if (tp != null && (dir > 0 ? c.o >= tp : c.o <= tp)) return { exitIdx: j, exitPx: c.o, outcome: 'TP' };
      const r = mode === 'path' ? scanPath(barPath(c), 1, c.o, dir, sl, tp) : consBar(c, dir, sl, tp);
      if (r) return { exitIdx: j, exitPx: r.px, outcome: r.hit };
    }
    return { exitIdx: lastIdx, exitPx: candles[lastIdx].c, outcome: 'Waktu' };
  }
  // Isi order stop (entry = -Infinity/Infinity berarti market di open) pada candle c, memakai lintasan intrabar.
  // Kembalikan {fill, seg} (titik lanjut lintasan), {cancel:true} bila SL tersentuh lebih dulu, atau null bila tidak terpicu.
  function fillStop(c, dir, entry, sl, mode) {
    if (dir > 0 ? c.o >= entry : c.o <= entry) return { fill: c.o, seg: 1 };
    if (mode !== 'path') {
      if (dir > 0 ? c.h >= entry : c.l <= entry) return { fill: entry, seg: 1 };
      if (sl != null && (dir > 0 ? c.l <= sl : c.h >= sl)) return { cancel: true };
      return null;
    }
    const pts = barPath(c);
    let cur = pts[0];
    for (let s = 1; s < pts.length; s++) {
      const nxt = pts[s];
      if (dir > 0) {
        if (nxt < cur && sl != null && nxt <= sl) return { cancel: true };
        if (nxt > cur && nxt >= entry) return { fill: entry, seg: s };
      } else {
        if (nxt > cur && sl != null && nxt >= sl) return { cancel: true };
        if (nxt < cur && nxt <= entry) return { fill: entry, seg: s };
      }
      cur = nxt;
    }
    return null;
  }

  // Simulasi satu trade dari sinyal di indeks i. Mengembalikan { trade, next }.
  // trade = null bila order tidak terisi / tidak valid; next = indeks berikutnya yang boleh dianalisis.
  // Urutan sentuhan di dalam candle: o.intrabar = 'conservative' (default: SL dianggap duluan → batas bawah)
  // atau 'path' (lintasan intrabar; pada entri stop cenderung optimis). Data 30m tidak bisa memastikan mana yang benar.
  function simulate(candles, i, side, plan, o, c2) {
    const n = candles.length;
    const dir = side === 'BUY' ? 1 : -1;
    const mode = o.intrabar === 'path' ? 'path' : 'conservative';
    const { entry, sl } = plan;

    // 1) tunggu entry terpicu dalam jendela fillWindow
    let fillIdx = -1;
    let f = null;
    for (let j = i + 1; j <= Math.min(n - 1, i + c2.fillWindow); j++) {
      f = fillStop(candles[j], dir, entry, sl, mode);
      if (f && f.cancel) return { trade: null, next: i + 1 }; // setup batal: SL tersentuh sebelum entri
      if (f) { fillIdx = j; break; }
    }
    if (fillIdx < 0) return { trade: null, next: i + 1 };
    const slip = o.slip || 0; // slippage: entri & exit SL terisi lebih buruk sebesar slip
    const fillPx = f.fill + dir * slip;
    const risk = dir * (fillPx - sl);
    if (!(risk > 0)) return { trade: null, next: fillIdx + 1 };
    // plan.tpR: TP = kelipatan risiko dari harga isi sebenarnya (untuk entri market / pencarian aturan keluar)
    const tp1 = plan.tpR != null ? fillPx + dir * plan.tpR * risk : plan.tp1;

    // 2) kelola posisi: sisa lintasan candle isi, lalu candle-candle berikutnya
    const lastIdx = Math.min(n - 1, fillIdx + c2.maxHold);
    let ex;
    const r0 = mode === 'path' ? scanPath(barPath(candles[fillIdx]), f.seg, fillPx, dir, sl, tp1) : consBar(candles[fillIdx], dir, sl, tp1);
    if (r0) ex = { exitIdx: fillIdx, exitPx: r0.px, outcome: r0.hit };
    else ex = manageFrom(candles, fillIdx, lastIdx, dir, sl, tp1, mode);
    if (ex.outcome === 'SL') ex.exitPx -= dir * slip;
    const gross = dir * (ex.exitPx - fillPx);
    const R = (gross - o.spread) / (risk + o.spread);
    return {
      trade: { signalIdx: i, fillIdx, exitIdx: ex.exitIdx, side, entry: fillPx, exit: ex.exitPx, sl, tp: tp1, R, outcome: ex.outcome },
      next: ex.exitIdx + 1,
    };
  }

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
      signals.push({ i, side: a.decision.action });
      const r = simulate(candles, i, a.decision.action, a.plan, o, c2);
      if (r.trade) trades.push(r.trade);
      i = r.next;
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

  // opts.stepMin: menit per candle (default 1440 = harian). <1440 → data intraday, hanya hari kerja.
  function generateDemo(kind, instId, n, seed, opts) {
    const inst = INSTRUMENTS[instId] || INSTRUMENTS.EURUSD;
    n = n || 260;
    const stepMin = (opts && opts.stepMin) || 1440;
    const intraday = stepMin < 1440;
    const lenScale = intraday ? Math.sqrt(1440 / stepMin) : 1;
    const rnd = mulberry32(seed == null ? 7 : seed);
    const gauss = () => {
      let u = 0;
      let v = 0;
      while (!u) u = rnd();
      while (!v) v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const vol = inst.vol * Math.sqrt(stepMin / 1440);
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
      len = Math.round(len * lenScale);
      segs.push({ type, d, len });
      total += len;
      pi++;
    }

    const out = [];
    let px = inst.price;
    let mu = px;
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    let nextDate;
    if (intraday) {
      // mulai dari beberapa hari lalu agar data berakhir kira-kira hari ini; lewati Sabtu & Minggu
      date.setUTCDate(date.getUTCDate() - Math.ceil(((n * stepMin) / 1440) * 1.4) - 1);
      while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
      let cur = date.getTime() - stepMin * 60000;
      nextDate = () => {
        cur += stepMin * 60000;
        for (let d = new Date(cur).getUTCDay(); d === 0 || d === 6; d = new Date(cur).getUTCDay()) {
          cur = Math.floor(cur / 86400000) * 86400000 + 86400000;
        }
        return new Date(cur).toISOString().slice(0, 16).replace('T', ' ');
      };
    } else {
      // mundur n hari kerja
      let back = n;
      while (back > 0) {
        date.setUTCDate(date.getUTCDate() - 1);
        if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) back--;
      }
      nextDate = () => {
        do date.setUTCDate(date.getUTCDate() + 1); while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
        return date.toISOString().slice(0, 10);
      };
    }
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

  /* ================================================================== */
  /* MULTI-TIMEFRAME: 1D (bias & level besar) → 4H (setup) → 30m (pemicu) */
  /* ================================================================== */
  const MIN_MS = 60000;
  const HOUR_MS = 3600000;
  const M30_MS = 30 * MIN_MS;
  const H4_MS = 4 * HOUR_MS;
  const D1_MS = 24 * HOUR_MS;

  const MTF_DEFAULTS = {
    mtfThreshold: 7, // Ketat 9 / Normal 7 / Longgar 6
    anchorMs: 0, // jam awal hari/4H terhadap 00:00 waktu data (untuk resample)
  };

  // Waktu dalam data diperlakukan sebagai waktu "naif" (zona waktu server yang sama di semua file).
  function toEpoch(t) {
    let s = String(t).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
    else {
      s = s.replace(' ', 'T');
      if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
    }
    return Date.parse(s);
  }
  function fmtEpoch(ms) {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
  function addEpoch(candles) {
    for (const c of candles) if (c.ts == null) c.ts = toEpoch(c.t);
    return candles;
  }

  // Menyusun candle timeframe lebih besar dari data yang lebih kecil (sinkron sempurna).
  function resample(candles, durMs, opt) {
    const o = Object.assign({ anchorMs: 0, minBars: 1 }, opt);
    const out = [];
    let cur = null;
    let key = null;
    const flush = () => { if (cur && cur.n >= o.minBars) out.push(cur); };
    for (const c of candles) {
      const ts = c.ts != null ? c.ts : toEpoch(c.t);
      const k = Math.floor((ts - o.anchorMs) / durMs);
      if (!cur || k !== key) {
        flush();
        key = k;
        const st = k * durMs + o.anchorMs;
        cur = { t: fmtEpoch(st), ts: st, o: c.o, h: c.h, l: c.l, c: c.c, n: 1 };
      } else {
        cur.h = Math.max(cur.h, c.h);
        cur.l = Math.min(cur.l, c.l);
        cur.c = c.c;
        cur.n++;
      }
    }
    flush();
    return out;
  }

  // Cek apakah file 4H/1D yang diimpor sejajar dengan file 30m (zona waktu sama): high/low tiap candle HTF
  // harus cocok dengan agregat candle 30m di dalamnya. Mengembalikan proporsi yang cocok (0..1).
  function checkAlignment(m30, other, durMs) {
    const byTs = new Map();
    for (const c of m30) byTs.set(c.ts != null ? c.ts : toEpoch(c.t), c);
    const steps = Math.round(durMs / M30_MS);
    let hit = 0;
    let tot = 0;
    const stepN = Math.max(1, Math.floor(other.length / 600));
    for (let k = 0; k < other.length; k += stepN) {
      const o = other[k];
      const ts = o.ts != null ? o.ts : toEpoch(o.t);
      let hi = -Infinity;
      let lo = Infinity;
      let cnt = 0;
      for (let j = 0; j < steps; j++) {
        const c = byTs.get(ts + j * M30_MS);
        if (c) { hi = Math.max(hi, c.h); lo = Math.min(lo, c.l); cnt++; }
      }
      if (cnt < Math.max(2, steps / 2)) continue; // terlalu sedikit data 30m untuk dibandingkan
      tot++;
      const tol = Math.abs(o.c) * 0.0003;
      if (Math.abs(hi - o.h) <= tol && Math.abs(lo - o.l) <= tol) hit++;
    }
    return tot ? hit / tot : 0;
  }

  function prepareMTF(src, opts) {
    const o = Object.assign({}, DEFAULTS, MTF_DEFAULTS, opts);
    const M = addEpoch(src.m30);
    if (!M.length || !Number.isFinite(M[0].ts)) throw new Error('Format waktu data 30m tidak dikenali.');
    const H = src.h4 && src.h4.length ? addEpoch(src.h4) : resample(M, H4_MS, { anchorMs: o.anchorMs });
    const D = src.d1 && src.d1.length ? addEpoch(src.d1) : resample(M, D1_MS, { anchorMs: o.anchorMs, minBars: 6 });
    if (H.length < o.minCandles || D.length < o.minCandles) {
      throw new Error('Riwayat 4H (' + H.length + ') atau 1D (' + D.length + ') kurang dari ' + o.minCandles + ' candle.');
    }
    const n = M.length;
    const hIdx = new Int32Array(n);
    const dIdx = new Int32Array(n);
    let ph = -1;
    let pd = -1;
    for (let i = 0; i < n; i++) {
      const close = M[i].ts + M30_MS; // candle 30m ke-i baru diketahui saat ia close
      while (ph + 1 < H.length && H[ph + 1].ts + H4_MS <= close) ph++;
      while (pd + 1 < D.length && D[pd + 1].ts + D1_MS <= close) pd++;
      hIdx[i] = ph;
      dIdx[i] = pd;
    }
    return {
      M, H, D, o, hIdx, dIdx,
      iM: computeIndicators(M, o), iH: computeIndicators(H, o), iD: computeIndicators(D, o),
      memo: { h: { idx: -2, a: null }, d: { idx: -2, a: null } },
      derived: { h4: !(src.h4 && src.h4.length), d1: !(src.d1 && src.d1.length) },
    };
  }

  function htfAnalysis(ctx, tf, idx) {
    const m = ctx.memo[tf];
    if (m.idx === idx) return m.a;
    const arr = tf === 'h' ? ctx.H : ctx.D;
    const ind = tf === 'h' ? ctx.iH : ctx.iD;
    m.a = analyzeAt(arr, idx, ctx.o, ind);
    m.idx = idx;
    return m.a;
  }

  const emaPts = (candles, ind, idx) => {
    const c = candles[idx].c;
    const slope = ind.ema[idx] - ind.ema[Math.max(0, idx - 3)];
    return c > ind.ema[idx] && slope > 0 ? 1 : c < ind.ema[idx] && slope < 0 ? -1 : 0;
  };

  // Analisis top-down pada candle 30m ke-i. quick=true: keluar cepat bila tidak ada pemicu (untuk backtest).
  function analyzeMTFAt(ctx, i, quick) {
    const o = ctx.o;
    const M = ctx.M;
    const c = M[i];
    const hi = ctx.hIdx[i];
    const di = ctx.dIdx[i];
    if (hi < o.minCandles - 1 || di < o.minCandles - 1) {
      return { ok: false, error: 'Riwayat 4H/1D belum cukup pada candle ini.' };
    }
    const atr = Math.max(ctx.iM.atr[i], Math.abs(c.c) * 1e-9, 1e-12);
    const pats = detectPatterns(M, i, atr);
    const bestBull = pats.filter((p) => p.bias === 'bull').sort((a, b) => b.quality - a.quality)[0] || null;
    const bestBear = pats.filter((p) => p.bias === 'bear').sort((a, b) => b.quality - a.quality)[0] || null;
    const trigBull = bestBull && bestBull.quality >= 2 ? bestBull : null;
    const trigBear = bestBear && bestBear.quality >= 2 ? bestBear : null;
    if (quick && !trigBull && !trigBear) {
      return { ok: true, i, decision: { action: 'WAIT' }, plan: null, score: 0, quick: true };
    }

    const D = htfAnalysis(ctx, 'd', di);
    const H = htfAnalysis(ctx, 'h', hi);
    const atrH = Math.max(ctx.iH.atr[hi], 1e-12);

    const breakdown = [];
    let S = 0;
    const add = (label, pts, note) => { S += pts; breakdown.push({ label, pts, note }); };

    // 1) Bias 1D
    const dTrend = D.structure.trend === 'up' ? 2 : D.structure.trend === 'down' ? -2 : 0;
    const dEma = emaPts(ctx.D, ctx.iD, di);
    add('1D struktur', dTrend, D.structure.label);
    add('1D EMA 20', dEma, dEma > 0 ? 'Close di atas EMA yang naik' : dEma < 0 ? 'Close di bawah EMA yang turun' : 'EMA tidak searah');

    // 2) Setup 4H
    const hTrend = H.structure.trend === 'up' ? 1 : H.structure.trend === 'down' ? -1 : 0;
    const hEma = emaPts(ctx.H, ctx.iH, hi);
    add('4H struktur', hTrend, H.structure.label);
    add('4H EMA 20', hEma, hEma > 0 ? 'Close di atas EMA yang naik' : hEma < 0 ? 'Close di bawah EMA yang turun' : 'EMA tidak searah');

    // 3) Pemicu candlestick 30m
    const bullQ = bestBull ? bestBull.quality : 0;
    const bearQ = bestBear ? bestBear.quality : 0;
    add('Pemicu 30m', bullQ - bearQ, bullQ || bearQ ? [bestBull && bestBull.name, bestBear && bestBear.name].filter(Boolean).join(' vs ') : 'Tidak ada pola pada candle 30m terakhir');

    // 4) Konfirmasi candlestick di 4H & 1D (candle terakhir yang sudah close)
    const hp = detectPatterns(ctx.H, hi, atrH).filter((p) => p.bias !== 'neutral' && p.quality >= 2);
    const dp = detectPatterns(ctx.D, di, Math.max(ctx.iD.atr[di], 1e-12)).filter((p) => p.bias !== 'neutral' && p.quality >= 2);
    let conf = 0;
    const confNames = [];
    for (const [tf, arr] of [['4H', hp], ['1D', dp]]) {
      const bu = arr.some((p) => p.bias === 'bull');
      const be = arr.some((p) => p.bias === 'bear');
      if (bu && !be) { conf += 1; confNames.push(tf + ' ' + arr.find((p) => p.bias === 'bull').name); }
      else if (be && !bu) { conf -= 1; confNames.push(tf + ' ' + arr.find((p) => p.bias === 'bear').name); }
    }
    add('Konfirmasi 4H/1D', conf, confNames.length ? confNames.join(', ') : 'Tidak ada pola 4H/1D pada candle terakhir');

    // 5) Lokasi: pemicu 30m muncul di level 4H / 1D
    const levels = D.levels.map((l) => Object.assign({ tf: 'd' }, l)).concat(H.levels.map((l) => Object.assign({ tf: 'h' }, l)));
    const spanOf = (sig) => {
      const sl = M.slice(i - (sig ? sig.span : 1) + 1, i + 1);
      return { lo: Math.min.apply(null, sl.map((x) => x.l)), hi: Math.max.apply(null, sl.map((x) => x.h)) };
    };
    const tolLoc = atrH * 0.5;
    const levelPts = (l) => Math.min(3, 1 + (l.touches >= 2 ? 1 : 0) + (l.tf === 'd' ? 1 : 0));
    const bs = spanOf(bestBull);
    const es = spanOf(bestBear);
    let locBull = 0;
    let locBear = 0;
    let locBullL = null;
    let locBearL = null;
    for (const l of levels) {
      const pt = levelPts(l);
      if (l.price <= c.c + tolLoc && bs.lo <= l.price + 0.75 * atrH && bs.lo >= l.price - 1.0 * atrH && pt > locBull) { locBull = pt; locBullL = l; }
      if (l.price >= c.c - tolLoc && es.hi >= l.price - 0.75 * atrH && es.hi <= l.price + 1.0 * atrH && pt > locBear) { locBear = pt; locBearL = l; }
    }
    const lname = (l) => (l.tf === 'd' ? '1D' : '4H') + ' ' + l.price.toFixed(o.dp != null ? o.dp : 5) + ' (' + l.touches + '×)';
    add('Lokasi', locBull - locBear,
      locBull || locBear
        ? [locBullL && 'support ' + lname(locBullL), locBearL && 'resistance ' + lname(locBearL)].filter(Boolean).join(' / ')
        : 'Tidak berada di level 4H/1D');

    /* ---- Keputusan ---- */
    const T = o.mtfThreshold;
    const warnings = [];
    const reasons = [];
    let action = 'WAIT';
    let plan = null;
    let sigUsed = null;
    const wantBuy = S >= T;
    const wantSell = S <= -T;
    if (wantBuy || wantSell) {
      const side = wantBuy ? 'BUY' : 'SELL';
      const sig = wantBuy ? trigBull : trigBear;
      const loc = wantBuy ? locBull : locBear;
      if (!sig) reasons.push('Bias ' + (wantBuy ? 'bullish' : 'bearish') + ' kuat, tetapi belum ada candle pemicu 30m (pin bar / engulfing / star / inside bar breakout).');
      else if (loc < 1) reasons.push('Ada pemicu 30m, tetapi tidak terjadi di level 4H/1D — entri di tengah ruang kosong tidak diambil.');
      else {
        const p = buildPlan(side, M, i, sig, atr, levels, o);
        if (p.tooWide) reasons.push('Stop loss terlalu jauh (' + (p.risk / atr).toFixed(1) + '× ATR 30m).');
        else if (p.rr1 < o.minRR) reasons.push('Ruang ke ' + (wantBuy ? 'resistance' : 'support') + ' 4H/1D terdekat terlalu sempit (RR ' + p.rr1.toFixed(2) + ' < ' + o.minRR + ').');
        else {
          action = side;
          plan = p;
          sigUsed = sig;
          p.notes.forEach((n) => warnings.push(n));
          if ((wantBuy && D.structure.trend === 'down') || (wantSell && D.structure.trend === 'up')) {
            warnings.push('Melawan struktur 1D — risiko lebih tinggi.');
          }
        }
      }
    } else if (Math.abs(S) >= T - 2) {
      reasons.push('Bias ' + (S > 0 ? 'bullish' : 'bearish') + ' (skor ' + S + ') hampir cukup — butuh ≥ ' + T + ' plus pemicu 30m di level 4H/1D.');
    } else {
      reasons.push('Tidak ada konfluensi 1D–4H–30m yang cukup (skor ' + S + ').');
    }

    const watch = [];
    if (action === 'WAIT') {
      const near = (dir) => levels.filter((l) => (dir > 0 ? l.price < c.c - 0.25 * atrH : l.price > c.c + 0.25 * atrH))
        .sort((a, b) => (dir > 0 ? b.price - a.price : a.price - b.price))[0];
      const sup = near(1);
      const res = near(-1);
      if (D.structure.trend === 'up') watch.push(sup ? 'Bias 1D naik: tunggu 30m membentuk pin bar/engulfing bullish di ' + lname(sup) + '.' : 'Bias 1D naik: tunggu pullback ke level lalu pemicu bullish 30m.');
      else if (D.structure.trend === 'down') watch.push(res ? 'Bias 1D turun: tunggu 30m membentuk pin bar/engulfing bearish di ' + lname(res) + '.' : 'Bias 1D turun: tunggu pullback ke level lalu pemicu bearish 30m.');
      else {
        if (sup) watch.push('1D sideways: area BUY di ' + lname(sup) + '.');
        if (res) watch.push('1D sideways: area SELL di ' + lname(res) + '.');
      }
    }

    const confidence = Math.abs(S) >= 10 ? 'Tinggi' : Math.abs(S) >= 8 ? 'Sedang' : 'Rendah';
    const summary = action === 'WAIT'
      ? 'WAIT — ' + reasons[0]
      : action + ' — ' + sigUsed.name + ' 30m di level ' + (action === 'BUY' ? locBullL : locBearL).price.toFixed(o.dp != null ? o.dp : 5) +
        ' dengan bias 1D ' + D.structure.label.split(' ')[0].toLowerCase() + ' / 4H ' + H.structure.label.split(' ')[0].toLowerCase() + '; RR TP1 = ' + plan.rr1.toFixed(2) + '.';

    return {
      ok: true, i, time: c.t, price: c.c, atr, score: S, breakdown,
      layers: {
        d1: { structure: D.structure, price: D.price, ema: D.ema, levels: D.levels, time: ctx.D[di].t, idx: di },
        h4: { structure: H.structure, price: H.price, ema: H.ema, levels: H.levels, time: ctx.H[hi].t, idx: hi },
        m30: { patterns: pats },
      },
      decision: { action, confidence, summary, reasons, warnings, watch, signal: sigUsed },
      plan,
    };
  }


  // Semua kandidat sinyal (bar 30m yang punya pemicu searah skor), lengkap dengan komponen skor,
  // agar ribuan variasi filter & aturan keluar bisa diuji cepat tanpa menganalisis ulang.
  function mtfEvents(ctx) {
    const saved = ctx.o;
    ctx.o = Object.assign({}, saved, { mtfThreshold: Infinity });
    ctx.memo = { h: { idx: -2, a: null }, d: { idx: -2, a: null } };
    const M = ctx.M;
    const out = [];
    try {
      for (let i = 0; i < M.length - 1; i++) {
        if (ctx.hIdx[i] < ctx.o.minCandles - 1 || ctx.dIdx[i] < ctx.o.minCandles - 1) continue;
        const a = analyzeMTFAt(ctx, i, true);
        if (!a.ok || a.quick) continue;
        const S = a.score;
        if (!S) continue;
        const dir = S > 0 ? 1 : -1;
        const sig = a.layers.m30.patterns
          .filter((p) => p.bias === (dir > 0 ? 'bull' : 'bear') && p.quality >= 2)
          .sort((x, y) => y.quality - x.quality)[0];
        if (!sig) continue;
        const pts = {};
        a.breakdown.forEach((b) => { pts[b.label] = b.pts * dir; });
        let lo = Infinity;
        let hi = -Infinity;
        for (let j = i - sig.span + 1; j <= i; j++) { lo = Math.min(lo, M[j].l); hi = Math.max(hi, M[j].h); }
        const levels = a.layers.d1.levels.map((l) => Object.assign({ tf: 'd' }, l)).concat(a.layers.h4.levels.map((l) => Object.assign({ tf: 'h' }, l)));
        const lp = buildPlan(dir > 0 ? 'BUY' : 'SELL', M, i, sig, a.atr, levels, saved);
        out.push({
          i, ts: M[i].ts, dir, score: S * dir,
          d1: pts['1D struktur'], d1e: pts['1D EMA 20'], h4: pts['4H struktur'], h4e: pts['4H EMA 20'],
          trig: sig.quality, key: sig.key, conf: pts['Konfirmasi 4H/1D'], loc: pts['Lokasi'],
          lo, hi, close: M[i].c, atr: a.atr, hour: new Date(M[i].ts + M30_MS).getUTCHours(),
          lvl: { entry: lp.entry, sl: lp.sl, tp1: lp.tp1, rr1: lp.rr1, tooWide: lp.tooWide },
        });
      }
    } finally {
      ctx.o = saved;
      ctx.memo = { h: { idx: -2, a: null }, d: { idx: -2, a: null } };
    }
    return out;
  }

  // Backtest multi-timeframe (async agar UI tidak membeku). cfg.onProgress(0..1), cfg.cancel() → true untuk berhenti.
  async function backtestMTF(ctx, cfg) {
    const o = ctx.o;
    const c2 = Object.assign({ fillWindow: 3, maxHold: 96, fromTs: null, onProgress: null, cancel: null }, cfg);
    const M = ctx.M;
    const n = M.length;
    const trades = [];
    const signals = [];
    let i = 0;
    while (i < n - 1 && (ctx.hIdx[i] < o.minCandles - 1 || ctx.dIdx[i] < o.minCandles - 1)) i++;
    if (c2.fromTs != null) while (i < n - 1 && M[i].ts < c2.fromTs) i++;
    const startAt = i;
    let last = Date.now();
    while (i < n - 1) {
      if (Date.now() - last > 60) {
        if (c2.cancel && c2.cancel()) return { cancelled: true, trades, signals, stats: tradeStats(trades), startAt };
        if (c2.onProgress) c2.onProgress((i - startAt) / Math.max(1, n - startAt));
        await new Promise((r) => setTimeout(r, 0));
        last = Date.now();
      }
      const a = analyzeMTFAt(ctx, i, true);
      if (!a.ok || a.decision.action === 'WAIT') { i++; continue; }
      signals.push({ i, side: a.decision.action, score: a.score });
      const r = simulate(M, i, a.decision.action, a.plan, o, c2);
      if (r.trade) {
        r.trade.score = a.score;
        r.trade.ts = M[r.trade.fillIdx].ts;
        trades.push(r.trade);
      }
      i = r.next;
    }
    if (c2.onProgress) c2.onProgress(1);
    return { cancelled: false, trades, signals, stats: tradeStats(trades), startAt };
  }

  /* ------------------------------------------------------------------ */
  /* Statistik & probabilitas                                            */
  /* ------------------------------------------------------------------ */
  // Interval kepercayaan Wilson untuk proporsi (lebih tepat dari normal untuk n kecil).
  function wilson(k, n, z) {
    z = z || 1.96;
    if (!n) return { p: 0, lo: 0, hi: 1 };
    const p = k / n;
    const d = 1 + (z * z) / n;
    const c = (p + (z * z) / (2 * n)) / d;
    const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
  }

  function groupStats(trades) {
    const s = tradeStats(trades);
    const w = wilson(s.wins, s.trades);
    const wins = trades.filter((t) => t.R > 0);
    const losses = trades.filter((t) => t.R <= 0);
    const avgWin = wins.length ? wins.reduce((x, t) => x + t.R, 0) / wins.length : 0;
    const avgLoss = losses.length ? Math.abs(losses.reduce((x, t) => x + t.R, 0)) / losses.length : 0;
    return {
      n: s.trades, wins: s.wins, winRate: s.winRate, ciLo: w.lo, ciHi: w.hi,
      avgR: s.avgR, totalR: s.totalR, profitFactor: s.profitFactor, maxDD: s.maxDD,
      avgWin, avgLoss,
      // win rate impas (expectancy = 0) untuk rata-rata menang/kalah yang teramati
      breakEven: avgWin + avgLoss > 0 ? avgLoss / (avgWin + avgLoss) : null,
      equity: s.equity,
    };
  }

  function summarizeMTF(trades, opts) {
    const o = Object.assign({ splitFrac: 0.7, scoreCap: 11, minScore: 7 }, opts);
    const by = (keyFn) => {
      const m = new Map();
      for (const t of trades) {
        const k = keyFn(t);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(t);
      }
      return m;
    };
    const overall = groupStats(trades);
    const byYear = [...by((t) => new Date(t.ts).getUTCFullYear()).entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => Object.assign({ key: k }, groupStats(v)));
    const bySide = [...by((t) => t.side).entries()].map(([k, v]) => Object.assign({ key: k }, groupStats(v)));
    const byScore = [...by((t) => Math.min(Math.abs(t.score), o.scoreCap)).entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => Object.assign({ key: k }, groupStats(v)));
    let split = null;
    if (trades.length >= 10) {
      const t0 = trades[0].ts;
      const t1 = trades[trades.length - 1].ts;
      const splitTs = o.splitTs != null ? o.splitTs : t0 + (t1 - t0) * o.splitFrac;
      split = {
        splitTs,
        inSample: groupStats(trades.filter((t) => t.ts < splitTs)),
        outSample: groupStats(trades.filter((t) => t.ts >= splitTs)),
      };
    }
    let verdict = 'Belum ada trade.';
    if (overall.n >= 1) {
      if (overall.n < 30) verdict = 'Sampel terlalu kecil (n=' + overall.n + ') untuk menyimpulkan apa pun.';
      else if (overall.breakEven != null && overall.ciLo > overall.breakEven && overall.avgR > 0) verdict = 'Win rate (batas bawah CI 95%) di atas titik impas dan ekspektasi positif — ada indikasi edge pada data ini, tetap perlu dikonfirmasi di luar sampel.';
      else if (overall.avgR <= 0) verdict = 'Ekspektasi ≤ 0 R setelah spread — aturan ini tidak menguntungkan pada data ini.';
      else verdict = 'Ekspektasi positif, tetapi batas bawah CI 95% belum melewati titik impas — belum bisa dibedakan dari keberuntungan.';
    }
    return { overall, byYear, bySide, byScore, split, verdict, scoreCap: o.scoreCap };
  }

  // Estimasi probabilitas menang historis untuk skor tertentu (dari hasil backtest).
  function probabilityForScore(summary, score) {
    if (!summary) return null;
    const key = Math.min(Math.abs(score), summary.scoreCap);
    const b = summary.byScore.find((x) => x.key === key);
    if (!b) return null;
    return { n: b.n, winRate: b.winRate, lo: b.ciLo, hi: b.ciHi, avgR: b.avgR, reliable: b.n >= 20 };
  }

  return {
    DEFAULTS, INSTRUMENTS,
    computeIndicators, findSwings, marketStructure, buildLevels, detectPatterns, buildPlan,
    analyze, analyzeAt, backtest, tradeStats, positionSize, pipValueUSD,
    parseCSV, inferPrecision, generateDemo,
    simulate, barPath, scanPath, consBar, manageFrom, fillStop, toEpoch, fmtEpoch, resample, checkAlignment, prepareMTF, analyzeMTFAt, backtestMTF,
    wilson, groupStats, summarizeMTF, probabilityForScore, MTF_DEFAULTS, mtfEvents,
  };
});
