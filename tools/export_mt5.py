"""
Ekspor riwayat M30 / H4 / D1 dari terminal MetaTrader 5 ke CSV (semua dari server & zona waktu yang sama).

  pip install MetaTrader5 pandas
  python tools/export_mt5.py XAUUSD 2020-01-01

Syarat: MT5 desktop (Windows) terbuka dan sudah login ke broker Anda. Riwayat yang tersedia bergantung pada
broker; bila kurang dari 2020, buka chart simbolnya lalu scroll ke kiri agar terminal mengunduh data lebih lama
(atur juga Tools > Options > Charts > "Max bars in chart" ke Unlimited).

CATATAN: skrip ini BELUM diuji oleh pembuatnya (butuh terminal MT5). Periksa hasil CSV sebelum dipakai.
"""
import sys
from datetime import datetime

import MetaTrader5 as mt5
import pandas as pd

symbol = sys.argv[1] if len(sys.argv) > 1 else "XAUUSD"
start = datetime.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else datetime(2020, 1, 1)

if not mt5.initialize():
    sys.exit(f"Gagal terhubung ke MT5: {mt5.last_error()}")
mt5.symbol_select(symbol, True)

for name, tf in [("M30", mt5.TIMEFRAME_M30), ("H4", mt5.TIMEFRAME_H4), ("D1", mt5.TIMEFRAME_D1)]:
    rates = mt5.copy_rates_range(symbol, tf, start, datetime.now())
    if rates is None or len(rates) == 0:
        print(f"{name}: tidak ada data ({mt5.last_error()})")
        continue
    df = pd.DataFrame(rates)
    df["time"] = pd.to_datetime(df["time"], unit="s")  # waktu server MT5, disimpan apa adanya
    out = f"{symbol}_{name}.csv"
    df[["time", "open", "high", "low", "close"]].to_csv(out, index=False, date_format="%Y-%m-%d %H:%M")
    print(f"{name}: {len(df)} candle  {df['time'].iloc[0]} -> {df['time'].iloc[-1]}  => {out}")

mt5.shutdown()
