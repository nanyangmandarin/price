'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PA = require('../engine.js');
const F = require('../tools/forward-test.js');
const rule = require('../forward/rule-xauusd-pinbar-h4.json');

const data = () => PA.generateDemo('mixed', 'XAUUSD', 40000, 31, { stepMin: 30 });

test('uji maju: trade sesuai aturan, tidak tumpang tindih, SL/TP konsisten', () => {
  const c = F.computeTrades(data(), rule);
  assert.ok(c.trades.length > 0);
  for (let k = 0; k < c.trades.length; k++) {
    const t = c.trades[k];
    assert.ok(t.score >= rule.rule.minScore);
    if (t.side === 'BUY') assert.ok(t.sl < t.entry && t.tp > t.entry); else assert.ok(t.sl > t.entry && t.tp < t.entry);
    // TP tepat 0,5R dari harga isi
    assert.ok(Math.abs(Math.abs(t.tp - t.entry) - rule.rule.tpR * Math.abs(t.entry - t.sl)) < 1e-6);
    if (k) assert.ok(Date.parse(t.entryTime.replace(' UTC', 'Z').replace(' ', 'T')) > Date.parse(c.trades[k - 1].exitTime.replace(' UTC', 'Z').replace(' ', 'T')));
  }
});

test('uji maju: trade selesai yang sudah tercatat tidak pernah diubah (tambah-saja)', () => {
  const m = data();
  const c = F.computeTrades(m, rule);
  const from = c.trades[Math.floor(c.trades.length / 2)].signalTs;
  const r1 = F.buildReport(Object.assign({}, rule, { forward_from: new Date(from).toISOString() }), c, null);
  const done = r1.forward.find((t) => t.status === 'selesai');
  assert.ok(done);
  // palsukan catatan lama → harus dipertahankan dan dihitung sebagai revisi
  const prev = JSON.parse(JSON.stringify(r1));
  prev.forward.find((t) => t.signalTime === done.signalTime).R = 9.99;
  const r2 = F.buildReport(Object.assign({}, rule, { forward_from: new Date(from).toISOString() }), c, prev);
  assert.equal(r2.forward.find((t) => t.signalTime === done.signalTime).R, 9.99);
  assert.ok(r2.dataRevisions >= 1);
  // trade sebelum forward_from tidak masuk uji maju
  assert.ok(r2.forward.every((t) => t.signalTs >= from));
});

test('uji maju: verdict mengikuti aturan evaluasi', () => {
  assert.match(F.verdict({ n: 0 }), /Belum/);
  assert.match(F.verdict({ n: 10 }), /Terlalu dini/);
  assert.match(F.verdict({ n: 30, avgRHi: -0.01 }), /DITOLAK/);
  assert.match(F.verdict({ n: 30, avgRHi: 0.2 }), /Belum ditolak/);
  const md = F.markdown(rule, F.buildReport(rule, F.computeTrades(data(), rule), null));
  assert.match(md, /Uji maju: xauusd-pinbar-h4-v1/);
});
