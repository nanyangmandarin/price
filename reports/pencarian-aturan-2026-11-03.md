# Pencarian aturan multi-timeframe — target win rate > 50%

Sumber: GitHub Actions run 41595071322 (commit `f1d85ee`), `tools/search-mtf.js`, data 30m Dukascopy (BID, UTC) dari run 41561545932.
Instrumen: XAU/USD, EUR/USD, GBP/USD, AUD/USD — satu konfigurasi yang sama untuk keempatnya. Spread: 3 / 1 / 1,2 / 1,2 pip.

**Protokol (ditetapkan sebelum melihat hasil):** pilih hanya dari data **latih 2020–2023**; laporkan 10 kandidat teratas pada data
**uji 2024 – Nov 2026** yang tidak dipakai saat memilih. Lolos latih: ≥150 trade, win rate > 50%, rata-rata R > 0. Bertahan di uji:
win rate > 50%, rata-rata R > 0, dan t-stat ≥ 2.

Ruang pencarian (3.780 konfigurasi): ambang skor 5–9 · keselarasan tren (tanpa / 1D / 1D+4H) · lokasi di level 4H/1D (wajib/bebas) ·
sesi (semua / London–New York 07–20 UTC) · pola (semua / pin bar / engulfing) · entri (stop / market) · SL (pola / 1,5×ATR) ·
TP (level 4H/1D, 0,5R, 0,75R, 1R, 1,5R, 2R).

## Hasil

| | Jumlah |
| --- | ---: |
| Konfigurasi diuji | 3.780 |
| Win rate latih > 50% (≥150 trade) | 1.611 |
| … di antaranya rugi (rata-rata R ≤ 0) | **1.552** |
| Lolos syarat latih (win > 50% **dan** untung) | 59 |
| 10 teratas yang tetap win > 50% & untung di data uji | **0** |
| … yang signifikan (t ≥ 2) | **0** |

Pembanding (aturan aplikasi saat ini, skor ≥ 7, TP di level): latih −0,106 R/trade (win 28,9%), uji −0,121 R/trade (win 29,2%).

Kandidat #1 dari data latih: skor ≥ 5, tren 1D & 4H searah, lokasi wajib, sesi London–NY, hanya pin bar, Buy/Sell Stop, SL di pola, TP 1R.
Latih: 169 trade, win 56,8%, +0,061 R (t = 0,85 — bahkan di data latih tidak signifikan). **Uji: 101 trade, win 52,5%, −0,026 R.**
Seluruh 10 kandidat teratas negatif di data uji (−0,016 sampai −0,177 R/trade).

## Kesimpulan

- Win rate > 50% **mudah dicapai** (1.611 konfigurasi), tetapi hampir semuanya (96%) rugi: TP yang dekat menaikkan win rate sekaligus
  memperkecil kemenangan sehingga spread dan kekalahan menghabiskannya.
- Tidak ada konfigurasi dalam keluarga aturan ini yang menghasilkan win rate > 50% **dan** keuntungan yang bertahan di data 2024–2026.
- Catatan (hipotesis, bukan temuan): pada banyak kandidat pin bar, XAU/USD tetap positif di data uji (+0,04 sampai +0,25 R, n = 29–60)
  sementara GBP/USD dan AUD/USD negatif. Sampelnya terlalu kecil dan pengamatan ini dibuat setelah melihat data uji, sehingga hanya bisa
  dibuktikan lewat uji maju (forward test / akun demo) pada data baru.
