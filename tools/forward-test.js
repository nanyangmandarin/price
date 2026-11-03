#!/usr/bin/env node
'use strict';
/*
 * Uji maju (forward test) aturan yang sudah dikunci di forward/rule-*.json.
 *   node tools/forward-test.js --data data/XAUUSD_M30.csv --rule forward/rule-xauusd-pinbar-h4.json \
 *        --out forward/xauusd-pinbar-h4.json --md forward/README.md
 * - Trade dengan sinyal >= forward_from adalah uji maju; sebelumnya hanya referensi historis.
 * - Catatan bersifat tambah-saja: trade maju yang sudah selesai di file lama tidak pernah diubah
 *   (bila data penyedia direvisi dan hasil hitung ulang berbeda, dicatat sebagai "revisi data").
 */
const fs = require('fs');
const PA = require('../engine.js');

const H = 3600000;
const H4_OPTS = {
  tfMs: { base: 4 * H, mid: 24 * H, top: 7 * 24 * H },
  tfNames: { top: '1W', mid: '1D', base: '4H' },
  anchorMs: 22 * H, anchorTopMs: PA.WEEK_ANCHOR_MS, minBarsMid: 2, minBarsTop: 2,
};
const fmt = (ts) => PA.fmtEpoch(ts) + ' UTC';

// Terapkan aturan pada seluruh data; kembalikan trade (selesai/terbuka) dan sinyal yang menunggu entri.
function computeTrades(m30, rule) {
  const inst = PA.INSTRUMENTS[rule.instrument];
  m30.forEach((c) => { if (c.ts == null) c.ts = PA.toEpoch(c.t); });
  const h4 = PA.resample(m30, 4 * H, { anchorMs: 22 * H, minBars: 2 });
  const spread = rule.costs.spreadPips * inst.pipSize;
  const slip = rule.costs.slipPips * inst.pipSize;
  const ctx = PA.prepareMTF({ m30: h4 }, Object.assign({ spread, slip, dp: PA.inferPrecision(m30) }, H4_OPTS));
  const M = ctx.M;
  const n = M.length;
  const R = rule.rule;
  const ev = PA.mtfEvents(ctx);
  const trades = [];
  let pending = null;
  let next = 0;
  for (const e of ev) {
    if (e.i < next) continue;
    if (e.score < R.minScore) continue;
    if (R.requireTopTrendAligned && !(e.d1 > 0)) continue;
    if (R.requireLocation && !(e.loc >= 1)) continue;
    if (e.key !== R.pattern) continue;
    const side = e.dir > 0 ? 'BUY' : 'SELL';
    const sl = e.close - e.dir * R.slAtr * e.atr;
    if (e.i >= n - 1) {
      pending = { signalTime: fmt(M[e.i].ts), side, score: e.score, close: e.close, sl, note: 'Masuk market pada open candle H4 berikutnya; TP = 0,5R dari harga isi.' };
      break;
    }
    const plan = { entry: e.dir > 0 ? -Infinity : Infinity, sl, tpR: R.tpR };
    const r = PA.simulate(M, e.i, side, plan, { spread, slip, intrabar: rule.costs.intrabar }, { fillWindow: R.fillWindow, maxHold: R.maxHoldBars });
    next = r.next;
    if (!r.trade) continue;
    const t = r.trade;
    const open = t.outcome === 'Waktu' && t.exitIdx === n - 1 && t.exitIdx < t.fillIdx + R.maxHoldBars;
    trades.push({
      signalTime: fmt(M[e.i].ts), signalTs: M[e.i].ts, side, score: e.score,
      entryTime: fmt(M[t.fillIdx].ts), entry: t.entry, sl: t.sl, tp: t.tp,
      status: open ? 'terbuka' : 'selesai',
      exitTime: open ? null : fmt(M[t.exitIdx].ts), exit: open ? null : t.exit, outcome: open ? null : t.outcome,
      R: open ? null : t.R, unrealizedR: open ? t.R : null,
    });
  }
  return { trades, pending, lastBar: fmt(M[n - 1].ts), lastClose: M[n - 1].c };
}

function summarize(closed) {
  const n = closed.length;
  if (!n) return { n: 0 };
  const wins = closed.filter((t) => t.R > 0).length;
  const mean = closed.reduce((s, t) => s + t.R, 0) / n;
  const sd = n > 1 ? Math.sqrt(closed.reduce((s, t) => s + (t.R - mean) ** 2, 0) / (n - 1)) : 0;
  const w = PA.wilson(wins, n);
  const ws = closed.filter((t) => t.R > 0);
  const ls = closed.filter((t) => t.R <= 0);
  const aw = ws.length ? ws.reduce((s, t) => s + t.R, 0) / ws.length : 0;
  const al = ls.length ? Math.abs(ls.reduce((s, t) => s + t.R, 0)) / ls.length : 1;
  return {
    n, wins, winRate: wins / n, winLo: w.lo, winHi: w.hi,
    avgR: mean, avgRLo: n > 1 ? mean - 1.96 * sd / Math.sqrt(n) : null, avgRHi: n > 1 ? mean + 1.96 * sd / Math.sqrt(n) : null,
    totalR: closed.reduce((s, t) => s + t.R, 0), breakEven: aw + al > 0 ? al / (aw + al) : null,
  };
}

function verdict(s) {
  if (!s.n) return 'Belum ada trade maju yang selesai.';
  if (s.n < 25) return 'Terlalu dini (' + s.n + ' trade; evaluasi pertama di 25 trade).';
  if (s.avgRHi != null && s.avgRHi < 0) return 'DITOLAK: batas atas CI 95% rata-rata R < 0 setelah ' + s.n + ' trade.';
  return 'Belum ditolak setelah ' + s.n + ' trade (bukan bukti edge — butuh ratusan trade untuk itu).';
}

// Gabungkan dengan hasil sebelumnya: trade maju yang sudah selesai tidak pernah diubah.
function mergeForward(prevForward, computed, forwardFromTs) {
  const prev = new Map((prevForward || []).map((t) => [t.signalTime, t]));
  const out = [];
  let revisions = 0;
  for (const t of computed.filter((x) => x.signalTs >= forwardFromTs)) {
    const p = prev.get(t.signalTime);
    if (p && p.status === 'selesai') {
      if (p.R !== t.R || p.exitTime !== t.exitTime) revisions++;
      out.push(p);
    } else out.push(Object.assign({ firstSeen: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }, p && p.firstSeen ? { firstSeen: p.firstSeen } : {}, t));
    prev.delete(t.signalTime);
  }
  // trade lama yang tidak muncul lagi (data direvisi) tetap disimpan
  for (const p of prev.values()) if (p.status === 'selesai') { out.push(p); revisions++; }
  out.sort((a, b) => a.signalTs - b.signalTs);
  return { trades: out, revisions };
}

function buildReport(rule, comp, prevJson) {
  const fwdFrom = Date.parse(rule.forward_from);
  const merged = mergeForward(prevJson && prevJson.forward, comp.trades, fwdFrom);
  const closed = merged.trades.filter((t) => t.status === 'selesai');
  const hist = comp.trades.filter((t) => t.signalTs < fwdFrom && t.status === 'selesai');
  const inRange = (a, b) => hist.filter((t) => t.signalTs >= Date.parse(a) && t.signalTs < Date.parse(b));
  const fs = summarize(closed);
  return {
    rule: rule.id, instrument: rule.instrument, forward_from: rule.forward_from,
    updated: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    lastBar: comp.lastBar, lastClose: comp.lastClose,
    forwardSummary: fs, verdict: verdict(fs), dataRevisions: merged.revisions,
    pending: comp.pending, open: merged.trades.filter((t) => t.status === 'terbuka'),
    forward: merged.trades,
    reference: {
      note: 'Referensi historis (BUKAN uji maju): latih = data pemilihan aturan, uji = 2024 s/d forward_from.',
      train: summarize(inRange('2020-01-01', '2024-01-01')),
      test: summarize(inRange('2024-01-01', rule.forward_from)),
    },
  };
}

function markdown(rule, rep) {
  const p = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
  const r = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(3));
  const row = (lab, s) => '| ' + lab + ' | ' + (s.n || 0) + ' | ' + (s.n ? p(s.winRate) + ' (' + p(s.winLo) + '–' + p(s.winHi) + ')' : '—') + ' | ' + (s.n ? r(s.avgR) : '—') + ' | ' + (s.n ? r(s.totalR) : '—') + ' | ' + (s.n ? p(s.breakEven) : '—') + ' |';
  const L = [];
  L.push('# Uji maju: ' + rule.id);
  L.push('');
  L.push('Diperbarui otomatis oleh workflow `forward-test.yml`. Terakhir: **' + rep.updated + '** · candle H4 terakhir: ' + rep.lastBar + ' (close ' + rep.lastClose + ').');
  L.push('');
  L.push('**Aturan terkunci** ([`rule-xauusd-pinbar-h4.json`](rule-xauusd-pinbar-h4.json), dikunci ' + rule.locked_at + ', uji maju sejak ' + rule.forward_from + '): ' +
    'XAU/USD, pin bar H4 dengan skor ≥ ' + rule.rule.minScore + ' searah struktur W1, entri market di open H4 berikutnya, SL ' + rule.rule.slAtr + '×ATR(14) H4, TP ' + rule.rule.tpR + 'R, maks ' + rule.rule.maxHoldBars + ' candle. Biaya: spread ' + rule.costs.spreadPips + ' + slippage ' + rule.costs.slipPips + ' pip.');
  L.push('');
  L.push('## Status: ' + rep.verdict);
  L.push('');
  L.push('| | Trade | Win rate (CI 95%) | Rata-rata R | Total R | Win rate impas |');
  L.push('| --- | ---: | --- | ---: | ---: | ---: |');
  L.push(row('**Uji maju**', rep.forwardSummary));
  L.push(row('Referensi: latih 2020–2023', rep.reference.train));
  L.push(row('Referensi: uji 2024 – ' + rule.forward_from.slice(0, 10), rep.reference.test));
  L.push('');
  if (rep.pending) L.push('**Sinyal menunggu entri:** ' + rep.pending.side + ' — sinyal ' + rep.pending.signalTime + ', close ' + rep.pending.close.toFixed(2) + ', SL ' + rep.pending.sl.toFixed(2) + '. ' + rep.pending.note);
  for (const t of rep.open) L.push('**Posisi terbuka:** ' + t.side + ' sejak ' + t.entryTime + ' @ ' + t.entry.toFixed(2) + ', SL ' + t.sl.toFixed(2) + ', TP ' + t.tp.toFixed(2) + ' (sementara ' + r(t.unrealizedR) + ' R).');
  if (rep.pending || rep.open.length) L.push('');
  if (rep.dataRevisions) L.push('_Catatan: ' + rep.dataRevisions + ' trade selesai berbeda bila dihitung ulang (data penyedia direvisi); catatan asli dipertahankan._\n');
  L.push('## Trade uji maju');
  L.push('');
  if (!rep.forward.length) L.push('Belum ada sinyal sejak ' + rule.forward_from + '.');
  else {
    L.push('| Sinyal | Arah | Skor | Entri | SL | TP | Status | Keluar | Hasil | R |');
    L.push('| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |');
    for (const t of rep.forward) L.push('| ' + t.signalTime + ' | ' + t.side + ' | ' + t.score + ' | ' + t.entry.toFixed(2) + ' | ' + t.sl.toFixed(2) + ' | ' + t.tp.toFixed(2) + ' | ' + t.status + ' | ' + (t.exitTime || '—') + ' | ' + (t.outcome || '—') + ' | ' + (t.R != null ? r(t.R) : '(' + r(t.unrealizedR) + ')') + ' |');
  }
  L.push('');
  L.push('Evaluasi: ' + rule.evaluation);
  L.push('');
  L.push('> Bukan nasihat keuangan. Ini catatan uji maju sebuah hipotesis, bukan sinyal trading.');
  return L.join('\n') + '\n';
}

module.exports = { computeTrades, summarize, verdict, mergeForward, buildReport, markdown };

if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
  const rule = JSON.parse(fs.readFileSync(arg('rule', 'forward/rule-xauusd-pinbar-h4.json'), 'utf8'));
  const m30 = PA.parseCSV(fs.readFileSync(arg('data', 'data/XAUUSD_M30.csv'), 'utf8')).candles;
  const outPath = arg('out', 'forward/xauusd-pinbar-h4.json');
  const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
  const rep = buildReport(rule, computeTrades(m30, rule), prev);
  fs.writeFileSync(outPath, JSON.stringify(rep, null, 1) + '\n');
  fs.writeFileSync(arg('md', 'forward/README.md'), markdown(rule, rep));
  console.log(rep.verdict + ' | maju: ' + rep.forward.length + ' trade | referensi uji: n=' + rep.reference.test.n + ' avgR ' + (rep.reference.test.avgR || 0).toFixed(3));
}
