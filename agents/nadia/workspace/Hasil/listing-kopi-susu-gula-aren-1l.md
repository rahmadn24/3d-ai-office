# Listing: Kopi Susu Gula Aren 1L

Sumber: `inbox/produk-kopi.json` — harga ikut file produk Rp35.000, tidak diubah.

## Varian judul (maks 100 karakter)

1. Kopi Susu Gula Aren 1 Liter – Arabika, Susu Fresh, Manis Pas
2. Kopi Susu Gula Aren Botol 1L – Tahan 3 Hari di Kulkas
3. Kopi Susu Gula Aren 1L – Pilihan Less Sugar / Extra Shot

## Deskripsi

Kopi Susu Gula Aren 1 liter, racikan kopi arabika, susu fresh, dan gula aren asli.

Fitur:
- Kopi arabika, susu fresh, gula aren asli
- Kemasan botol 1 liter, praktis untuk stok di kulkas
- Tahan 3 hari di kulkas
- Pilihan less sugar dan extra shot

Isi paket:
- 1 botol Kopi Susu Gula Aren 1 liter (sesuai variasi yang dipilih)

Cara order:
- Pilih variasi, cantumkan jumlah botol dan jadwal pengiriman
- Simpan di kulkas segera setelah diterima, kocok sebelum diminum
- Catatan foto: foto botol di atas meja kayu, label belum final

## Tabel variasi

| Variasi | Harga | Selisih dari harga dasar (Rp35.000) |
|---|---|---|
| Reguler | Rp35.000 | +Rp0 |
| Less sugar | Rp35.000 | +Rp0 |
| Extra shot | Rp40.000 | +Rp5.000 |
| Paket 3 botol | Rp95.000 (3 x Rp35.000 − Rp10.000) | −Rp10.000 dari total normal Rp105.000 |

## Validasi (skrip, dijalankan sebelum final)

Perintah:

```sh
python3 -c "import json,pathlib,re; p=json.load(open('inbox/produk-kopi.json')); t=pathlib.Path('Hasil/listing-kopi-susu-gula-aren-1l.md').read_text().split('## Validasi')[0]; titles=[l.strip() for l in t.splitlines() if re.match(r'^[0-9]\.\s', l.strip())][:3]; assert len(titles)==3, titles; assert all(len(x.split('. ',1)[1])<=100 for x in titles), titles; assert not re.search(r'menyembuhkan|\bobat\b|\bgratis\b|original 100%|tokopedia|shopee|lazada|tiktok', t, re.I), 'kata terlarang'; assert str(p['harga']) in t.replace('.','').replace(',','').replace('Rp',''); print('OK:', titles)"
```
