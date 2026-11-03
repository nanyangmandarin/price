# Price Action Decision

Aplikasi web untuk membantu keputusan **BUY / SELL / WAIT** pada **forex dan gold (XAU/USD)** dengan metode *price action*: struktur pasar, support/resistance, dan pola candle. Tanpa dependensi dan tanpa build step.

> Alat bantu analisis, **bukan nasihat keuangan**. Trading berleverage berisiko tinggi. Uji di akun demo.

## Menjalankan

Buka `index.html` di browser, atau `npm start` lalu buka http://localhost:8080. Tes: `npm test` (Node 18+).

## Fitur

- **Keputusan BUY / SELL / WAIT** dengan skor, tingkat keyakinan, dan rincian alasan per komponen.
- **Rencana trade**: Buy/Sell Stop, entry, SL, TP1, TP2, RR, dalam harga dan **pip**.
- **Kalkulator lot**: dari modal, % risiko, jarak SL + spread, dan nilai pip per lot (otomatis untuk EUR/USD, GBP/USD, AUD/USD, NZD/USD, USD/JPY, USD/CHF, USD/CAD, EUR/JPY, GBP/JPY, **XAU/USD**, atau kustom).
- **Chart** candlestick dengan S/R, EMA 20, swing, label pola, rencana trade, dan crosshair.
- **Replay**: geser/klik candle untuk melihat keputusan di masa lalu, dengan candle setelahnya ditampilkan pudar untuk belajar. Tombol lompat ke sinyal sebelumnya/berikutnya.
- **Backtest** aturan yang sama: win rate, rata-rata R, total R, profit factor, max drawdown, kurva ekuitas.
- **Multi-timeframe 1D · 4H · 30m**: bias 1D → setup 4H → pemicu candlestick 30m di level 4H/1D, lengkap dengan backtest sejak 2020, win rate + interval kepercayaan, titik impas, statistik per tahun/skor/arah, dan uji out-of-sample (lihat bagian di bawah).
- **Data**: impor CSV (MT4/MT5, TradingView, Dukascopy, dll.), input candle manual, atau data contoh sintetis.

## Impor data

| Sumber | Cara |
| --- | --- |
| MT4 | Tools → History Center → pilih pair/timeframe → Export |
| MT5 | View → Symbols → Bars → Export Bars (CSV bertab dengan `<DATE> <TIME>`) |
| TradingView | Export chart data… (CSV) |

Header opsional, pemisah koma/titik-koma/tab, urutan terbalik (terbaru dulu) dikenali otomatis. Gunakan candle yang **sudah close**.

## Cara keputusan dibuat

Skor bias (positif = bullish), maksimum sekitar ±10:

| Komponen | Poin |
| --- | --- |
| Struktur pasar (HH+HL naik / LH+LL turun) | ±2 |
| Harga vs EMA 20 yang searah | ±1 |
| Pola candle pemicu (Pin Bar, Engulfing, Inside Bar Breakout, Morning/Evening Star) | 1 sampai 3 |
| Lokasi di support (BUY) / resistance (SELL); level yang disentuh ≥3× bernilai lebih | 2 sampai 3 |
| BOS / CHoCH baru | ±1 |

**BUY/SELL hanya muncul bila:** skor mencapai ambang (Normal ±6; Ketat ±7; Longgar ±5), **ada candle pemicu** berkualitas ≥2, SL tidak lebih jauh dari 3×ATR, dan **RR ke TP1 ≥ minimum** (default 1,5) dengan level S/R terdekat sebagai batas target. Selain itu hasilnya **WAIT** beserta skenario yang perlu ditunggu. Setup counter-trend sulit lolos dan diberi peringatan.

Rencana: entry stop di atas/bawah high/low pola (+0,1×ATR), SL di sisi lain pola (+0,25×ATR, minimal 0,5×ATR), TP1 sebelum level S/R terdekat (atau 2R bila ruang terbuka), TP2 di level berikutnya atau ≥3R.

## Multi-timeframe 1D · 4H · 30m

Top-down, semua analisis hanya memakai candle 4H/1D yang **sudah close** saat candle 30m ditutup:

| Lapisan | Peran | Poin |
| --- | --- | --- |
| 1D | Bias: struktur (HH/HL, LH/LL) dan EMA 20; level S/R besar | ±2 struktur, ±1 EMA |
| 4H | Setup: struktur dan EMA 20; level S/R menengah | ±1 struktur, ±1 EMA |
| 30m | Pemicu candlestick: pin bar, engulfing, inside bar breakout, morning/evening star | 1 sampai 3 |
| 4H/1D | Konfirmasi pola candlestick pada candle terakhir yang close | ±1 per timeframe |
| Lokasi | Pemicu 30m terjadi di level 4H/1D (level 1D dan yang disentuh ≥2× bernilai lebih) | 1 sampai 3 |

BUY/SELL hanya bila skor ≥ ambang (Normal 7; Ketat 9; Longgar 6), **ada pemicu 30m, pemicu itu terjadi di level 4H/1D** (syarat wajib), dan RR ke TP1 (level 4H/1D terdekat) ≥ minimum. Entry Buy/Sell Stop di atas/bawah pola, SL di sisi lain pola, keluar penuh di TP1 atau SL.

### Mendapatkan probabilitas & win rate dari data 2020–sekarang

Aplikasi tidak mengunduh data pasar sendiri (kebanyakan penyedia tidak mengizinkan akses dari browser). Anda cukup menyediakan **satu file 30m**; 4H dan 1D disusun otomatis dari 30m sehingga pasti sinkron.

1. Ekspor 30m dari broker. MT5: `python tools/export_mt5.py XAUUSD 2020-01-01` (skrip ini belum diuji penulisnya), atau *Export Bars* manual. TradingView/Dukascopy juga bisa.
2. Di aplikasi: pilih instrumen, buka kartu **Multi-timeframe**, unggah file 30m, klik **Jalankan analisis & backtest**. 80 ribu candle selesai dalam hitungan detik.
3. Atau lewat terminal: `node tools/mtf-report.js --m30 data/XAUUSD_M30.csv --inst XAUUSD --spread 3 --from 2020-01-01`.

File 4H/1D sendiri boleh diunggah, tetapi harus dari sumber dan zona waktu yang sama; aplikasi menolaknya bila isinya tidak cocok dengan 30m (mencegah look-ahead diam-diam).

### Hasil pada data nyata (Dukascopy 2020–2026)

Aturan Normal (skor ≥ 7) diuji di XAU/USD, EUR/USD, GBP/USD, AUD/USD dan **tidak menunjukkan edge**: ekspektasi −0,02 sampai −0,18 R per trade setelah spread, dan tidak stabil antar tahun. Ringkasan lengkap: [`reports/hasil-dukascopy-2026-11-03.md`](reports/hasil-dukascopy-2026-11-03.md). Pencarian 3.780 variasi aturan (latih 2020–2023, uji 2024–2026) juga tidak menemukan aturan dengan win rate > 50% yang tetap untung di data uji: [`reports/pencarian-aturan-2026-11-03.md`](reports/pencarian-aturan-2026-11-03.md) (workflow `mtf-search.yml`). Workflow `mtf-backtest.yml` (Actions → Run workflow) mengulang pengujian dengan data terbaru.

### Cara membaca hasil

- **Win rate dengan CI 95% (Wilson)** dibandingkan dengan **win rate impas**. Win rate tinggi belum berarti untung bila rata-rata kalah lebih besar dari rata-rata menang.
- **Per skor**: peluang menang historis untuk tiap tingkat konfluensi; dipakai juga pada keputusan terkini.
- **Per tahun** dan **out-of-sample**: konsistensi. Edge yang hanya ada di satu tahun, atau hilang di periode akhir, hampir pasti kebetulan.
- Mengutak-atik pengaturan sampai hasil bagus pada data yang sama adalah *overfitting*. Tetapkan aturan dulu, lalu nilai di periode yang belum pernah Anda lihat.
- Probabilitas adalah frekuensi historis, bukan jaminan.

## Backtest: asumsi

Analisis hanya memakai candle yang sudah close (tanpa look-ahead; ada tes yang memverifikasinya). Order stop harus terpicu dalam 3 candle; keluar penuh di TP1 atau SL; bila SL dan TP tersentuh di candle yang sama dihitung SL; maksimum 30 candle; spread ikut dihitung; **tanpa** swap, komisi, atau slippage. Data contoh sintetis dibuat acak, jadi hasil backtest-nya hanya demonstrasi dan bukan bukti profitabilitas. Evaluasi dengan data broker Anda, di beberapa periode.

## Struktur

- `engine.js`: mesin analisis murni (browser dan Node), dengan tes di `test/engine.test.js` (termasuk tes simetri BUY/SELL dan tes tanpa look-ahead)
- `app.js`, `index.html`, `styles.css`: antarmuka
- `tools/mtf-report.js`: laporan backtest multi-timeframe dari CSV (Node); `tools/export_mt5.py`: ekspor data MT5
