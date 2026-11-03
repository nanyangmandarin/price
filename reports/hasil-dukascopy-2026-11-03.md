# Hasil backtest multi-timeframe — data nyata Dukascopy

Sumber: GitHub Actions run 41561545932 (commit `2f3ca65`), workflow `mtf-backtest.yml`.
Data: candle 30m harga **BID** Dukascopy (UTC), 1 Juli 2019 → 3 Nov 2026; 4H/1D diturunkan dari 30m (hari mulai 22:00 UTC).
Pengujian: 1 Januari 2020 → 3 Nov 2026. Aturan **tidak dioptimalkan**: satu set parameter yang ditetapkan sebelum melihat data
(skor ≥ 7, RR TP1 ≥ 1,5, keluar penuh di TP1/SL, maks 96 candle). Spread tetap: XAUUSD 3 pip ($0,30), EURUSD 1, GBPUSD 1,2, AUDUSD 1,2 pip.
Angka disalin dari log run tersebut.

| Instrumen | Candle 30m | Trade | Win rate (CI 95%) | Win rate impas | Rata-rata R | Profit factor | Max DD | In-sample R | Out-of-sample R |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| XAU/USD | 86.853 | 480 | 30,8% (26,9–35,1) | 31,3% | −0,02 | 0,98 | 58,7 R | −0,09 | +0,10 |
| EUR/USD | 91.353 | 444 | 26,4% (22,5–30,6) | 31,9% | −0,18 | 0,76 | 87,6 R | −0,24 | −0,04 |
| GBP/USD | 91.577 | 434 | 29,5% (25,4–33,9) | 31,4% | −0,06 | 0,92 | 35,6 R | +0,02 | −0,25 |
| AUD/USD | 91.579 | 467 | 28,7% (24,8–33,0) | 33,1% | −0,14 | 0,81 | 87,7 R | −0,01 | −0,49 |

**Kesimpulan:** pada keempat instrumen, ekspektasi ≤ 0 R setelah spread. Win rate berada di bawah (atau, untuk emas, sekitar) titik impas
dan tidak ada yang konsisten per tahun. Skor konfluensi yang lebih tinggi **tidak** menghasilkan peluang menang yang lebih tinggi secara monoton
(mis. EUR/USD: skor 11+ → 9% menang; GBP/USD: skor 11+ → 0%), sehingga angka "peluang per skor" di aplikasi bukan prediktor yang bisa diandalkan.
Aturan ini, sebagaimana ditetapkan, tidak menunjukkan edge pada data ini.

Keterbatasan: spread tetap (aslinya melebar saat rollover/berita), tanpa swap/slippage, keluar penuh di TP1 (belum menguji parsial/trailing),
4H/1D diturunkan dengan jam awal hari tetap 22:00 UTC (mengabaikan DST), dan harga BID Dukascopy bukan feed broker Anda.
