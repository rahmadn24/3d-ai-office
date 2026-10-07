const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'db.json');
const PORT = Number(process.env.PORT) || 3103;

function loadDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveDb(rows) {
  fs.writeFileSync(DB_PATH, JSON.stringify(rows, null, 2) + '\n');
}

function validate(b) {
  if (!b || typeof b !== 'object') return 'Body harus JSON object.';
  if (typeof b.nama !== 'string' || b.nama.trim().length < 3)
    return 'nama minimal 3 huruf.';
  const digits = String(b.kontak ?? '').replace(/\D/g, '');
  if (digits.length < 9) return 'kontak minimal 9 digit angka.';
  if (typeof b.pesan !== 'string' || b.pesan.trim().length < 10)
    return 'pesan minimal 10 huruf.';
  return null;
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/kontak') {
    return send(res, 200, { ok: true, data: loadDb() });
  }
  if (req.method !== 'POST' || (url.pathname !== '/kontak' && url.pathname !== '/')) {
    return send(res, 404, { ok: false, error: 'Gunakan POST /kontak' });
  }
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 1e6) req.destroy(); // ponytail: batas 1MB anti-banjir, naikkan bila pesan besar diizinkan
  });
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return send(res, 400, { ok: false, error: 'Body bukan JSON valid.' });
    }
    const err = validate(body);
    if (err) return send(res, 400, { ok: false, error: err });
    const rows = loadDb();
    const id = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
    const row = {
      id,
      nama: body.nama.trim(),
      kontak: String(body.kontak).trim(),
      pesan: body.pesan.trim(),
      savedAt: new Date().toISOString(),
    };
    rows.push(row);
    saveDb(rows);
    return send(res, 201, { ok: true, id });
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`kontak API :${PORT}`));
}

module.exports = { server, validate, loadDb };
