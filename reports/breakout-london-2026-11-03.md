# Breakout sesi London — pencarian aturan, target win rate > 50%

Sumber: GitHub Actions run 41597511185 (mode konservatif) dan 41598074024 (mode lintasan/optimis), `tools/search-london.js`,
data 30m Dukascopy (BID, UTC) XAU/USD, EUR/USD, GBP/USD, AUD/USD dari run 41561545932.

**Strategi:** range sesi Asia (jam lokal London, termasuk DST) → entri saat range ditembus setelah London buka → satu trade per hari.
**Protokol (ditetapkan sebelum melihat hasil):** latih 2020–2023, uji 2024 – Nov 2026; satu konfigurasi untuk keempat instrumen;
lolos latih: ≥150 trade, win > 50%, rata-rata R > 0; bertahan di uji: win > 50%, rata-rata R > 0, t ≥ 2.
**Biaya:** spread (XAU 3 pip, EUR 1, GBP/AUD 1,2) + slippage pada entri & exit SL (XAU 1 pip, forex 0,2 pip).
**Ruang pencarian (5.760):** awal range 00/02/04 · London buka 07/08 · batas entri 11/13 · keluar 16/20 · entri stop/close ·
buffer 0/0,1 range · SL seberang/tengah range · TP 0,5/1/1,5/2R/tanpa · filter lebar range (semua/sempit/tidak lebar) · filter tren harian.

**Validasi simulator sebelum data nyata:** pada random walk (lintasan 1 menit/6 detik), versi awal simulator menghasilkan edge palsu
hingga −0,06 R (terlalu pesimis) dan +0,06 R (terlalu optimis). Mode konservatif final menghasilkan nol edge palsu (t maks 1,5);
karena masih pesimis untuk SL ketat, pencarian juga diulang dengan mode lintasan sebagai batas atas.

## Hasil

| | Konservatif (batas bawah) | Lintasan (batas atas) |
| --- | ---: | ---: |
| Versi klasik (00–07, stop s/d 11, SL seberang, TP 1R, keluar 16) — latih | −0,044 R, win 49,0%, t = −3,1 | −0,047 R, win 48,8%, t = −3,3 |
| Versi klasik — uji | −0,017 R, win 50,8% | −0,020 R, win 50,7% |
| Konfigurasi dengan win rate latih > 50% | 1.039 | 1.463 |
| … di antaranya rugi | **1.039 (semua)** | **1.463 (semua)** |
| Lolos syarat latih (win > 50% dan untung) | **0** | **0** |
| Untung di latih dengan t ≥ 2 (berapa pun win rate-nya) | 0 | 0 |

Lima konfigurasi teratas menurut ekspektasi di data latih (semuanya: range 00–08, range sempit, SL seberang, tanpa TP, keluar 20:00;
win rate 36–41%, t latih ≤ 1,5 — tidak signifikan) **semuanya negatif di data uji** (−0,02 sampai −0,08 R/trade) pada kedua mode.

## Kesimpulan

Pada data ini, breakout sesi London tidak menghasilkan win rate > 50% yang menguntungkan dalam variasi apa pun yang diuji, bahkan
dengan asumsi eksekusi paling optimis. Win rate > 50% hanya didapat dengan TP dekat, dan seluruhnya rugi setelah spread & slippage.
