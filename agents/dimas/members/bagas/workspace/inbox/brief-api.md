# Brief: API form kontak Hexa

Buat `api/kontak.js`: terima POST JSON {nama, kontak, pesan}, validasi
(nama min 3 huruf, kontak min 9 digit, pesan min 10 huruf), simpan ke
`api/db.json` (append array), response `{ok:true, id}`. Plus `Hasil/api-kontak.md`
berisi cara pakai + bukti uji (curl via skrip node).
