# API kontak Hexa

Stdlib only (`node:http`, `node:fs`). Tanpa dependensi npm.

Jalankan: `PORT=3103 node api/kontak.js`

## POST /kontak

Body (JSON):

```json
{ "nama": "Budi Santoso", "kontak": "08123456789", "pesan": "Halo, saya tertarik dengan layanan Hexa." }
```

Validasi: `nama` min 3 huruf, `kontak` min 9 digit angka (non-digit
diabaikan saat hitung), `pesan` min 10 huruf. Gagal → `400 {ok:false, error}`.

Sukses → `201 {ok:true, id}`. Data append ke `api/db.json` (array).

## GET /kontak

Balas `200 {ok:true, data:[...]}` — isi `db.json`.

## Contoh (skrip node, bukan kira-kira)

POST valid + 3 POST invalid + 1 GET, server lokal port 3999:

```
VALID: 201 {"ok":true,"id":1}
NAMA-PENDEK: 400 {"ok":false,"error":"nama minimal 3 huruf."}
KONTAK-PENDEK: 400 {"ok":false,"error":"kontak minimal 9 digit angka."}
PESAN-PENDEK: 400 {"ok":false,"error":"pesan minimal 10 huruf."}
GET: 200 {"ok":true,"data":[{"id":1,"nama":"Budi Santoso","kontak":"08123456789","pesan":"Halo, saya tertarik dengan layanan Hexa.","savedAt":"2026-10-06T22:40:28.604Z"}]}
```

DB setelah uji di-reset ke `[]` agar data uji tidak ikut deploy.

→ skipped: rate-limit/auth, add when endpoint publik tanpa proteksi abuse.
