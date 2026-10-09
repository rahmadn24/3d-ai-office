// Runs BEFORE any test file loads (node --test inherits --import in children).
// Gives every test process its own throwaway SQLite DB so files can run in
// parallel without locking each other. Test files chdir() to their own
// fixture dirs at load time (lib reads process.cwd() at call time).
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), ".test-dist", "dbs");
fs.mkdirSync(dir, { recursive: true });
process.env.KANTOR_DB = path.join(dir, `t-${process.pid}.db`);
