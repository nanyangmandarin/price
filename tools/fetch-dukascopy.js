#!/usr/bin/env node
'use strict';
/*
 * Unduh candle 30m (harga BID, UTC) dari Dukascopy ke CSV, per tahun.
 *   npm i --no-save dukascopy-node
 *   node tools/fetch-dukascopy.js xauusd 2019-07-01 data/XAUUSD_M30.csv
 * Data Dukascopy gratis untuk keperluan pribadi/analisis; patuhi ketentuan layanannya.
 */
const fs = require('fs');
const path = require('path');

const [, , inst, fromArg, outArg] = process.argv;
if (!inst) { console.error('Pemakaian: node tools/fetch-dukascopy.js <instrumen> [dari YYYY-MM-DD] [file keluaran]'); process.exit(1); }
const from = new Date((fromArg || '2019-07-01') + 'T00:00:00Z');
const out = outArg || path.join('data', inst.toUpperCase() + '_M30.csv');
const { getHistoricalRates } = require('dukascopy-node');

const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

(async () => {
  const rows = new Map();
  const now = new Date();
  for (let y = from.getUTCFullYear(); y <= now.getUTCFullYear(); y++) {
    const a = new Date(Math.max(from.getTime(), Date.UTC(y, 0, 1)));
    const b = new Date(Math.min(now.getTime() - 3600000, Date.UTC(y + 1, 0, 1)));
    if (b <= a) continue;
    const t0 = Date.now();
    let data;
    try {
      data = await getHistoricalRates({
        instrument: inst.toLowerCase(),
        dates: { from: a, to: b },
        timeframe: 'm30',
        format: 'json',
        priceType: 'bid',
        ignoreFlats: true,
        batchSize: 10,
        pauseBetweenBatchesMs: 250,
        retryCount: 3,
        useCache: false,
      });
    } catch (e) {
      console.error('GAGAL mengunduh ' + inst + ' tahun ' + y + ': ' + (e.code || '') + ' ' + (e.message || e));
      process.exit(2);
    }
    for (const r of data) rows.set(r.timestamp, r);
    console.log(inst.toUpperCase() + ' ' + y + ': ' + data.length + ' candle (' + Math.round((Date.now() - t0) / 1000) + ' dtk)');
  }
  const sorted = [...rows.values()].sort((p, q) => p.timestamp - q.timestamp);
  if (sorted.length < 1000) { console.error('Data terlalu sedikit (' + sorted.length + ').'); process.exit(3); }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, 'time,open,high,low,close\n' + sorted.map((r) => [iso(r.timestamp), r.open, r.high, r.low, r.close].join(',')).join('\n') + '\n');
  console.log('Tersimpan: ' + out + ' — ' + sorted.length + ' candle, ' + iso(sorted[0].timestamp) + ' → ' + iso(sorted[sorted.length - 1].timestamp) + ' (UTC)');
})();
