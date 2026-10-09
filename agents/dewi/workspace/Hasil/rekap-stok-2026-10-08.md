# Rekap Stok — 2026-10-08

Sumber: `inbox/stok.csv`, `inbox/pengeluaran.md`. Angka dihitung skrip (bukan kira-kira).

## Tabel stok

| item | qty | min | harga (Rp) | nilai (Rp) | status |
|---|---|---|---|---|---|
| kertas-a4 | 2 | 5 | 55.000 | 110.000 | ⚠️ BELI |
| tinta-printer | 1 | 2 | 120.000 | 120.000 | ⚠️ BELI |
| amplop-coklat | 50 | 20 | 2.000 | 100.000 | aman |
| materai-10000 | 3 | 5 | 10.000 | 30.000 | ⚠️ BELI |
| kabel-hdmi | 0 | 1 | 85.000 | 0 | ⚠️ BELI |

- Nilai total stok: **Rp360.000**
- Item di bawah minimum: **4** (kertas-a4, tinta-printer, materai-10000, kabel-hdmi)

## Pengeluaran minggu ini

- 2026-10-05: parkir + bensin kurir — Rp75.000 (tunai)
- 2026-10-06: beli materai 5 lbr — Rp50.000 (transfer)
- **Total: Rp125.000**

## Daftar belanja usulan

Qty usulan = selisih ke batas minimum (tanpa buffer). Estimasi = qty usulan × harga CSV.

| item | qty usulan | estimasi (Rp) |
|---|---|---|
| kertas-a4 | 3 | 165.000 |
| tinta-printer | 1 | 120.000 |
| materai-10000 | 2 | 20.000 |
| kabel-hdmi | 1 | 85.000 |
| **Total** | | **390.000** |

Catatan: `pricelist.json` (workspace Gilang) berisi harga jasa — tidak relevan untuk ATK, jadi harga pakai kolom `harga` di `stok.csv`. Belanja butuh persetujuan owner — lihat `decisions.json`. File stok tidak diubah, hanya rekap.
