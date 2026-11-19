# Uji maju: xauusd-pinbar-h4-v1

Diperbarui otomatis oleh workflow `forward-test.yml`. Terakhir: **2026-11-19 04:15 UTC** · candle H4 terakhir: 2026-11-19 02:00 UTC (close 3713.891).

**Aturan terkunci** ([`rule-xauusd-pinbar-h4.json`](rule-xauusd-pinbar-h4.json), dikunci 2026-11-03T08:30:00Z, uji maju sejak 2026-11-03T22:00:00Z): XAU/USD, pin bar H4 dengan skor ≥ 7 searah struktur W1, entri market di open H4 berikutnya, SL 1.5×ATR(14) H4, TP 0.5R, maks 30 candle. Biaya: spread 3 + slippage 1 pip.

## Status: Terlalu dini (2 trade; evaluasi pertama di 25 trade).

| | Trade | Win rate (CI 95%) | Rata-rata R | Total R | Win rate impas |
| --- | ---: | --- | ---: | ---: | ---: |
| **Uji maju** | 2 | 100.0% (34.2%–100.0%) | +0.491 | +0.983 | 67.1% |
| Referensi: latih 2020–2023 | 99 | 72.7% (63.2%–80.5%) | +0.067 | +6.634 | 68.2% |
| Referensi: uji 2024 – 2026-11-03 | 74 | 73.0% (61.9%–81.8%) | +0.081 | +5.965 | 67.5% |

## Trade uji maju

| Sinyal | Arah | Skor | Entri | SL | TP | Status | Keluar | Hasil | R |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |
| 2026-11-15 22:00 UTC | SELL | 9 | 3868.85 | 3920.15 | 3843.19 | selesai | 2026-11-16 02:00 UTC | TP | +0.491 |
| 2026-11-16 14:00 UTC | SELL | 9 | 3856.05 | 3907.42 | 3830.36 | selesai | 2026-11-17 22:00 UTC | TP | +0.491 |

Evaluasi: Dievaluasi setiap 25 trade maju yang selesai. Hipotesis DITOLAK bila batas atas CI 95% rata-rata R < 0. Edge kecil (sekitar +0,08 R/trade) baru bisa dibuktikan signifikan setelah ratusan trade; uji maju ini terutama mendeteksi aturan yang rusak.

> Bukan nasihat keuangan. Ini catatan uji maju sebuah hipotesis, bukan sinyal trading.
