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

## Backtest: asumsi

Analisis hanya memakai candle yang sudah close (tanpa look-ahead; ada tes yang memverifikasinya). Order stop harus terpicu dalam 3 candle; keluar penuh di TP1 atau SL; bila SL dan TP tersentuh di candle yang sama dihitung SL; maksimum 30 candle; spread ikut dihitung; **tanpa** swap, komisi, atau slippage. Data contoh sintetis dibuat acak, jadi hasil backtest-nya hanya demonstrasi dan bukan bukti profitabilitas. Evaluasi dengan data broker Anda, di beberapa periode.

## Struktur

- `engine.js`: mesin analisis murni (browser dan Node), dengan tes di `test/engine.test.js` (termasuk tes simetri BUY/SELL dan tes tanpa look-ahead)
- `app.js`, `index.html`, `styles.css`: antarmuka
