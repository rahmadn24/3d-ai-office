import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { addDecision, finishRun, logRun } from "./db";
import { memberPath, memberWorkspace } from "./roster";

const MODEL = process.env.KANTOR_MODEL || "9router/oc/muse-spark-1.3-contributor-free";
const OPENCODE_BIN = process.env.OPENCODE_BIN || "/Users/macintoshhd/.opencode/bin/opencode";

export interface AgentDecision {
  type: string;
  title: string;
  detail?: string;
  suggestion?: string;
  payload?: unknown;
}

function runCmd(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as { code?: unknown; signal?: unknown };
          reject(
            new Error(
              `exit ${String(e.code)} signal ${String(e.signal)}: ${String(stderr || err.message).slice(0, 2000)}`,
            ),
          );
        } else {
          resolve(stdout);
        }
      },
    );
    // Detach stdin: headless runs must never block on an interactive prompt.
    // EOF on stdin makes any unexpected prompt fail fast instead of hanging.
    try {
      child.stdin?.end();
    } catch {
      /* ignore */
    }
  });
}

/**
 * Wake one division: run `opencode run` in its workspace, then import the
 * machine-readable decisions.json it wrote into pending_decisions.
 */
export async function runDivision(division: string): Promise<{ runId: number; decisions: number }> {
  const root = memberPath(division);
  const workspace = memberWorkspace(division);
  if (!fs.existsSync(path.join(root, "SYSTEM.md"))) {
    throw new Error(`unknown division: ${division}`);
  }
  const runId = logRun(division);
  let stdout = "";
  let stderrTail = "";
  const saveLog = () => {
    try {
      const dir = path.join(process.cwd(), "data", "runs");
      fs.mkdirSync(dir, { recursive: true });
      const body = `$ opencode run --model ${MODEL}\n\n--- STDOUT ---\n${stdout.slice(-2_000_000)}\n\n--- STDERR ---\n${stderrTail.slice(-20000)}`;
      fs.writeFileSync(path.join(dir, `run-${runId}.log`), body);
    } catch {
      /* best effort */
    }
  };

  // Drop any stale decisions file so we never re-import yesterday's asks.
  const decisionsFile = path.join(workspace, "decisions.json");
  try {
    fs.rmSync(decisionsFile);
  } catch {
    /* absent is fine */
  }

  const system = fs.readFileSync(path.join(root, "SYSTEM.md"), "utf-8");
  const prompt = `${system}\n\n## Tugas malam ini\nKerjakan sesuai peranmu. Baca pricelist.json dan semua file di inbox/. Tulis proposal ke Hasil/. Tulis decisions.json (array, boleh kosong). Terakhir, balas dengan satu baris ringkasan untuk log.`;

  try {
    stdout = await runCmd(
      OPENCODE_BIN,
      ["run", "--format", "json", "--model", MODEL, prompt],
      workspace,
      1_800_000,
    );
  } catch (err) {
    stderrTail = String(err);
    saveLog();
    finishRun(runId, "failed", `${String(err).slice(0, 300)} (full log: data/runs/run-${runId}.log)`);
    throw err;
  }

  let imported = 0;
  let decisionsFound = false;
  try {
    const raw = fs.readFileSync(decisionsFile, "utf-8");
    const parsed = JSON.parse(raw) as AgentDecision[];
    if (Array.isArray(parsed)) {
      decisionsFound = true;
      for (const d of parsed) {
        if (d && typeof d.title === "string" && typeof d.type === "string") {
          addDecision(division, d);
          imported++;
        }
      }
    }
  } catch {
    /* agent wrote no decisions file -> nothing to import */
  }

  // opencode prints errors as JSON events on stdout with exit 0; surface them.
  if (!decisionsFound && stdout.includes('"type":"error"')) {
    const m = stdout.match(/"message":"((?:[^"\\]|\\.)*)"/);
    const msg = m ? m[1].slice(0, 300) : "agent reported error, no decisions.json";
    saveLog();
    finishRun(runId, "failed", `${msg} (full log: data/runs/run-${runId}.log)`);
    throw new Error(msg);
  }

  finishRun(runId, imported > 0 ? "needs_you" : "ok", `${imported} keputusan diminta`);
  saveLog();
  return { runId, decisions: imported };
}
