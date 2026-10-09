# Laporan Iklan Mingguan — 2026-10-09

Sumber: `inbox/iklan-export.csv` (4 campaign, seminggu terakhir).

## Perintah skrip (angka dari sini, bukan kira-kira)

```bash
python3 -c "
import csv
rows=list(csv.DictReader(open('inbox/iklan-export.csv')))
ts=tr=to=0
for r in rows:
    s=int(r['spend']); v=int(r['revenue']); o=int(r['orders'])
    ts+=s; tr+=v; to+=o
    roas=(v/s if s else 0); cpa=(s/o if o else None)
    print(f\"{r['campaign']}: spend={s} revenue={v} orders={o} ROAS={roas:.2f} CPA={'-' if cpa is None else int(cpa)}\")
print(f\"TOTAL: spend={ts} revenue={tr} orders={to} ROAS={tr/ts:.2f} CPA={int(ts/to) if to else '-'}\")
"
```

## Tabel (ROAS = revenue/spend, CPA = spend/orders)

| campaign | spend | revenue | orders | ROAS | CPA |
|---|---|---:|---:|---:|---:|
| search-jasa-website | 750000 | 3500000 | 1 | 4.67 | 750000 |
| search-toko-online | 500000 | 0 | 0 | 0.00 | - |
| sosmed-boost-portofolio | 300000 | 600000 | 1 | 2.00 | 300000 |
| sosmed-boost-testimoni | 200000 | 0 | 0 | 0.00 | - |
| **TOTAL** | **1750000** | **4100000** | **2** | **2.34** | **875000** |

## Insight

1. search-jasa-website paling kerja (ROAS 4.67, satu-satunya penopang revenue).
2. search-toko-online dan sosmed-boost-testimoni boncos (ROAS 0.00, spend 700000 tanpa revenue).
3. sosmed-boost-portofolio pas batas aman (ROAS 2.00), pertahankan dulu sambil awasi.
