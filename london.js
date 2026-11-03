/*
 * Strategi breakout sesi London (tanpa dependensi; browser: window.LONDON, Node: require).
 * Waktu data dianggap UTC. Jam sesi memakai waktu lokal London (GMT/BST, termasuk DST).
 *
 * Aturan per hari (tanggal lokal London):
 *  1. Range = high/low candle 30m dengan jam lokal di [rangeStart, rangeEnd).
 *  2. Filter (opsional): ukuran range relatif rata-rata range harian 14 hari sebelumnya; arah tren harian (EMA 20 harian s/d kemarin).
 *  3. Entri di jendela [rangeEnd, windowEnd): stop di atas high / bawah low range (+buffer), atau close 30m di luar range → masuk open berikutnya.
 *     Satu trade per hari (tembusan pertama). Urutan sentuhan di dalam candle: mode 'conservative' (default; SL dianggap
 *     duluan, candle yang menembus dua sisi dilewati → batas bawah) atau 'path' (lintasan O→L→H→C / O→H→L→C → cenderung optimis).
 *  4. SL: sisi range seberang atau tengah range. TP: kelipatan R dari harga isi, atau tanpa TP.
 *  5. Keluar paksa pada close candle terakhir sebelum exitHour lokal.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.LONDON = factory(root.PA);
})(typeof self !== 'undefined' ? self : this, function (PA) {
  'use strict';
  const HOUR = 3600000;
  const DAY = 24 * HOUR;

  // 01:00 UTC pada Minggu terakhir bulan m (0 = Jan) tahun y
  function lastSundayUtc(y, m) {
    const d = new Date(Date.UTC(y, m + 1, 0));
    return Date.UTC(y, m, d.getUTCDate() - d.getUTCDay(), 1);
  }
  const bstCache = {};
  function londonOffsetMs(ts) {
    const y = new Date(ts).getUTCFullYear();
    const b = bstCache[y] || (bstCache[y] = [lastSundayUtc(y, 2), lastSundayUtc(y, 9)]);
    return ts >= b[0] && ts < b[1] ? HOUR : 0;
  }

  // Kelompokkan candle 30m per tanggal lokal London + data harian kausal (ADR 14 hari & tren s/d kemarin)
  function buildDays(M) {
    const days = [];
    let cur = null;
    for (let i = 0; i < M.length; i++) {
      const loc = M[i].ts + londonOffsetMs(M[i].ts);
      const key = Math.floor(loc / DAY);
      if (!cur || cur.key !== key) {
        cur = { key, idx: [], hours: [], h: -Infinity, l: Infinity, c: 0 };
        days.push(cur);
      }
      cur.idx.push(i);
      cur.hours.push((loc - key * DAY) / HOUR);
      cur.h = Math.max(cur.h, M[i].h);
      cur.l = Math.min(cur.l, M[i].l);
      cur.c = M[i].c;
    }
    const k = 2 / 21;
    let ema = null;
    let prevEma = null;
    for (let d = 0; d < days.length; d++) {
      const D = days[d];
      // hanya hari-hari SEBELUMNYA (kausal)
      const prev = days.slice(Math.max(0, d - 14), d);
      D.adr = prev.length >= 10 ? prev.reduce((s, x) => s + (x.h - x.l), 0) / prev.length : null;
      D.trend = 0;
      if (ema != null && prevEma != null && d > 0) {
        const yc = days[d - 1].c;
        if (yc > ema && ema > prevEma) D.trend = 1;
        else if (yc < ema && ema < prevEma) D.trend = -1;
      }
      prevEma = ema;
      ema = ema == null ? D.c : D.c * k + ema * (1 - k);
      D.weekday = new Date(D.key * DAY).getUTCDay();
    }
    return days;
  }

  // Jalankan strategi pada satu instrumen. cfg: {rangeStart, rangeEnd, windowEnd, exitHour, entry:'stop'|'close',
  // buffer (×range), sl:'opposite'|'mid', tp: angka R | null, rangeFilter:'all'|'narrow'|'notwide', trend: bool}
  // slip: slippage (satuan harga) pada entri dan exit SL.
  function run(M, days, cfg, spread, mode, slip) {
    slip = slip || 0;
    const path = mode === 'path';
    const trades = [];
    let ambiguous = 0;
    for (let d = 15; d < days.length; d++) {
      const D = days[d];
      if (D.weekday === 0 || D.weekday === 6) continue;
      let hi = -Infinity;
      let lo = Infinity;
      let nRange = 0;
      const win = [];
      const after = [];
      for (let k = 0; k < D.idx.length; k++) {
        const h = D.hours[k];
        const c = M[D.idx[k]];
        if (h >= cfg.rangeStart && h < cfg.rangeEnd) { hi = Math.max(hi, c.h); lo = Math.min(lo, c.l); nRange++; }
        else if (h >= cfg.rangeEnd && h < cfg.windowEnd) win.push(D.idx[k]);
        if (h >= cfg.rangeEnd && h < cfg.exitHour) after.push(D.idx[k]);
      }
      const need = (cfg.rangeEnd - cfg.rangeStart) * 2 * 0.75;
      if (nRange < need || !win.length || !(hi > lo)) continue;
      const rng = hi - lo;
      if (cfg.rangeFilter !== 'all') {
        if (!D.adr) continue;
        const rel = rng / D.adr;
        if (cfg.rangeFilter === 'narrow' && rel > 0.35) continue;
        if (cfg.rangeFilter === 'notwide' && rel > 0.6) continue;
      }
      const up = hi + cfg.buffer * rng;
      const dn = lo - cfg.buffer * rng;
      const allowUp = !cfg.trend || D.trend > 0;
      const allowDn = !cfg.trend || D.trend < 0;
      if (!allowUp && !allowDn) continue;

      // --- entri ---
      let dir = 0;
      let fillIdx = -1;
      let fill = 0;
      let seg = 1;
      for (let w = 0; w < win.length; w++) {
        const c = M[win[w]];
        if (cfg.entry === 'stop') {
          const hu = allowUp && c.h >= up;
          const hd = allowDn && c.l <= dn;
          if (!hu && !hd) continue;
          if (hu && hd) { ambiguous++; if (!path) break; }
          if (!path) {
            dir = hu ? 1 : -1;
            fill = hu ? Math.max(up, c.o) : Math.min(dn, c.o);
            fillIdx = win[w];
            break;
          }
          // tembusan pertama menurut lintasan intrabar
          const pts = PA.barPath(c);
          let cur = pts[0];
          if (hu && c.o >= up) { dir = 1; fill = c.o; seg = 1; }
          else if (hd && c.o <= dn) { dir = -1; fill = c.o; seg = 1; }
          else {
            for (let s = 1; s < pts.length && !dir; s++) {
              const nxt = pts[s];
              if (hu && nxt > cur && nxt >= up) { dir = 1; fill = up; seg = s; }
              else if (hd && nxt < cur && nxt <= dn) { dir = -1; fill = dn; seg = s; }
              cur = nxt;
            }
          }
          fillIdx = win[w];
          break;
        } else {
          let s = 0;
          if (allowUp && c.c > up) s = 1;
          else if (allowDn && c.c < dn) s = -1;
          if (s) {
            const nxt = win[w] + 1;
            if (after.indexOf(nxt) < 0) break; // tidak ada candle berikutnya dalam sesi
            dir = s; fillIdx = nxt; fill = M[nxt].o; seg = 1;
            break;
          }
        }
      }
      if (!dir) continue;
      const sl = cfg.sl === 'mid' ? (hi + lo) / 2 : dir > 0 ? dn : up;
      fill += dir * slip;
      const risk = dir * (fill - sl);
      if (!(risk > 0)) continue;
      const tp = cfg.tp != null ? fill + dir * cfg.tp * risk : null;

      // --- kelola posisi sampai exitHour ---
      const lastIdx = after[after.length - 1];
      let ex;
      const r0 = path ? PA.scanPath(PA.barPath(M[fillIdx]), seg, fill, dir, sl, tp) : PA.consBar(M[fillIdx], dir, sl, tp);
      if (r0) ex = { exitIdx: fillIdx, exitPx: r0.px, outcome: r0.hit };
      else ex = PA.manageFrom(M, fillIdx, lastIdx, dir, sl, tp, path ? 'path' : 'conservative');
      const exit = ex.outcome === 'SL' ? ex.exitPx - dir * slip : ex.exitPx;
      const outcome = ex.outcome;
      const exitIdx = ex.exitIdx;
      const R = (dir * (exit - fill) - spread) / (risk + spread);
      trades.push({ ts: M[fillIdx].ts, dir, fill, sl, tp, exit, R, outcome, fillIdx, exitIdx });
    }
    return { trades, ambiguous };
  }

  return { londonOffsetMs, buildDays, run };
});
