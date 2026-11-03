'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../london.js');
const H = 3600000;

test('DST London: GMT di musim dingin, BST di musim panas, batas tepat', () => {
  assert.equal(L.londonOffsetMs(Date.UTC(2024, 0, 15, 8)), 0);
  assert.equal(L.londonOffsetMs(Date.UTC(2024, 6, 1, 8)), H);
  // 2024: BST mulai 31 Mar 01:00 UTC, berakhir 27 Okt 01:00 UTC
  assert.equal(L.londonOffsetMs(Date.UTC(2024, 2, 31, 0, 59)), 0);
  assert.equal(L.londonOffsetMs(Date.UTC(2024, 2, 31, 1, 0)), H);
  assert.equal(L.londonOffsetMs(Date.UTC(2024, 9, 27, 0, 59)), H);
  assert.equal(L.londonOffsetMs(Date.UTC(2024, 9, 27, 1, 0)), 0);
});

// Buat hari-hari candle 30m: hari pengisi datar + satu hari uji dengan jalur khusus
function makeDays(testDayBars, nFill = 20) {
  const M = [];
  const base = Date.UTC(2024, 0, 1); // Januari → GMT (offset 0)
  let d = 0;
  const push = (day, h, o, hi, lo, c) => M.push({ t: '', ts: base + day * 24 * H + h * H, o, h: hi, l: lo, c });
  for (; d < nFill; d++) {
    if (new Date(base + d * 24 * H).getUTCDay() % 6 === 0) continue;
    for (let h = 0; h < 24; h += 0.5) push(d, h, 100, 100.5, 99.5, 100);
  }
  while (new Date(base + d * 24 * H).getUTCDay() % 6 === 0) d++;
  for (const [h, o, hi, lo, c] of testDayBars) push(d, h, o, hi, lo, c);
  return M;
}
const asia = [];
for (let h = 0; h < 7; h += 0.5) asia.push([h, 100, 100.4, 99.6, 100]); // range 99.6–100.4

const CFG = { rangeStart: 0, rangeEnd: 7, windowEnd: 11, exitHour: 16, entry: 'stop', buffer: 0, sl: 'opposite', tp: 1, rangeFilter: 'all', trend: false };

test('breakout naik → TP 1R tercapai', () => {
  const bars = asia.concat([[7, 100.2, 100.5, 100.1, 100.45], [7.5, 100.45, 101.3, 100.4, 101.2]]);
  for (let h = 8; h < 16; h += 0.5) bars.push([h, 101.2, 101.3, 101.1, 101.2]);
  const M = makeDays(bars);
  const r = L.run(M, L.buildDays(M), CFG, 0);
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.dir, 1);
  assert.ok(Math.abs(t.fill - 100.4) < 1e-9);       // isi di high range
  assert.ok(Math.abs(t.sl - 99.6) < 1e-9);          // SL di low range
  assert.ok(Math.abs(t.tp - 101.2) < 1e-9);         // 1R = 0.8
  assert.equal(t.outcome, 'TP');
  assert.ok(Math.abs(t.R - 1) < 1e-9);
});

test('breakout turun lalu berbalik → SL tepat -1R (spread sudah termasuk dalam risiko)', () => {
  const bars = asia.concat([[7, 100, 100.1, 99.5, 99.55], [7.5, 99.55, 100.5, 99.5, 100.45]]);
  for (let h = 8; h < 16; h += 0.5) bars.push([h, 100.45, 100.5, 100.4, 100.45]);
  const M = makeDays(bars);
  const t = L.run(M, L.buildDays(M), CFG, 0.02).trades[0];
  assert.equal(t.dir, -1);
  assert.equal(t.outcome, 'SL');
  assert.ok(Math.abs(t.R + 1) < 1e-9);
});

test('candle yang menembus dua sisi: konservatif → dilewati; path → urutan O→L→H→C; tanpa TP → keluar saat exitHour', () => {
  let M = makeDays(asia.concat([[7, 100, 100.6, 99.4, 100]]));
  let r = L.run(M, L.buildDays(M), CFG, 0);
  assert.equal(r.ambiguous, 1);
  assert.equal(r.trades.length, 0);
  // mode path: candle naik (c>=o): low dulu → short terisi di 99.6, lalu naik ke 100.6 → SL di 100.4
  r = L.run(M, L.buildDays(M), CFG, 0, 'path');
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].dir, -1);
  assert.equal(r.trades[0].outcome, 'SL');
  const bars = asia.concat([[7, 100.2, 100.5, 100.1, 100.45]]);
  for (let h = 7.5; h < 18; h += 0.5) bars.push([h, 100.6, 100.7, 100.5, 100.6]);
  M = makeDays(bars);
  r = L.run(M, L.buildDays(M), Object.assign({}, CFG, { tp: null }), 0);
  const t = r.trades[0];
  assert.equal(t.outcome, 'Waktu');
  assert.ok(Math.abs(t.exit - 100.6) < 1e-9);
  assert.equal(new Date(M[t.exitIdx].ts).getUTCHours() + new Date(M[t.exitIdx].ts).getUTCMinutes() / 60, 15.5); // candle terakhir sebelum 16:00
});

test('entri close: masuk di open candle berikutnya', () => {
  const bars = asia.concat([[7, 100.2, 100.6, 100.1, 100.55], [7.5, 100.6, 100.7, 100.5, 100.65]]);
  for (let h = 8; h < 16; h += 0.5) bars.push([h, 100.65, 100.7, 100.6, 100.65]);
  const M = makeDays(bars);
  const t = L.run(M, L.buildDays(M), Object.assign({}, CFG, { entry: 'close', tp: null }), 0).trades[0];
  assert.equal(t.dir, 1);
  assert.equal(t.fill, 100.6);
});

test('ADR & tren hanya memakai hari-hari sebelumnya (kausal)', () => {
  const bars = asia.concat([[7, 100, 150, 50, 140]]); // hari uji sangat besar
  const M = makeDays(bars);
  const days = L.buildDays(M);
  const last = days[days.length - 1];
  assert.ok(Math.abs(last.adr - 1) < 1e-9); // hanya hari pengisi (range 1.0), tidak termasuk hari ini
});

test('slippage memperburuk entri dan exit SL (R kalah < -1)', () => {
  const bars = asia.concat([[7, 100, 100.1, 99.5, 99.55], [7.5, 99.55, 100.5, 99.5, 100.45]]);
  for (let h = 8; h < 16; h += 0.5) bars.push([h, 100.45, 100.5, 100.4, 100.45]);
  const M = makeDays(bars);
  const t = L.run(M, L.buildDays(M), CFG, 0, 'conservative', 0.02).trades[0];
  assert.ok(Math.abs(t.fill - 99.58) < 1e-9);   // short terisi 0.02 lebih rendah
  assert.ok(Math.abs(t.exit - 100.42) < 1e-9);  // SL 100.4 terisi 0.02 lebih tinggi
  assert.ok(t.R < -1);
});
