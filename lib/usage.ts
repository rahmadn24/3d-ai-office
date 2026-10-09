/** Token usage from run logs (ruang-style observability).
 *
 *  Every `opencode run --format json` step_finish event carries
 *  {"tokens":{"input","output","reasoning","cache":{"read","write"}}}.
 *  We sum those per run-<id>.log and join to the runs table for
 *  division + started_at. Cost is always 0 on the free-tier model, so
 *  tokens are the currency here — not rupiah.
 */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";

export interface RunTokens {
  id: number;
  division: string;
  started_at: string;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageReport {
  range: string;
  since: string;
  runs: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  byMember: Array<{ division: string; tokens: number; input: number; output: number; runs: number; share: number }>;
  rows: RunTokens[];
}

function parseLogTokens(file: string): { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number } {
  const acc = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  let body: string;
  try {
    body = fs.readFileSync(file, "utf-8");
  } catch {
    return acc;
  }
  // Match each "tokens":{...} object including its nested "cache":{...}.
  const chunks = body.match(/"tokens":(\{(?:[^{}]|\{[^{}]*\})*\})/g) ?? [];
  for (const c of chunks) {
    const num = (k: string): number => {
      const m = c.match(new RegExp(`"${k}":(\\d+)`));
      return m ? Number(m[1]) : 0;
    };
    acc.input += num("input");
    acc.output += num("output");
    acc.reasoning += num("reasoning");
    const cache = c.match(/"cache":\{([^{}]*)\}/);
    if (cache) {
      const cn = (k: string): number => {
        const m = cache[1].match(new RegExp(`"${k}":(\\d+)`));
        return m ? Number(m[1]) : 0;
      };
      acc.cacheRead += cn("read");
      acc.cacheWrite += cn("write");
    }
  }
  return acc;
}

const RANGE_HOURS: Record<string, number> = { "24h": 24, "7d": 7 * 24, "30d": 30 * 24 };

// 60s cache per range (ruang-style); ?fresh=1 bypasses it at the API layer.
const cache = new Map<string, { at: number; report: UsageReport }>();

export function getUsage(range: string, fresh = false): UsageReport {
  const hours = RANGE_HOURS[range] ?? RANGE_HOURS["7d"];
  const key = range in RANGE_HOURS ? range : "7d";
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.report;

  const since = new Date(Date.now() - hours * 3600_000);
  const db = getDb();
  const runs = db
    .prepare("SELECT id, division, started_at FROM runs WHERE datetime(started_at) >= datetime(?) ORDER BY id DESC")
    .all(since.toISOString()) as Array<{ id: number; division: string; started_at: string }>;
  const runsDir = path.join(process.cwd(), "data", "runs");

  const rows: RunTokens[] = runs.map((r) => {
    const t = parseLogTokens(path.join(runsDir, `run-${r.id}.log`));
    const total = t.input + t.output + t.reasoning;
    return { ...r, ...t, total };
  });

  const sum = (f: (r: RunTokens) => number): number => rows.reduce((a, r) => a + f(r), 0);
  const grand = sum((r) => r.total) || 1;
  const per = new Map<string, { tokens: number; input: number; output: number; runs: number }>();
  for (const r of rows) {
    const e = per.get(r.division) ?? { tokens: 0, input: 0, output: 0, runs: 0 };
    e.tokens += r.total;
    e.input += r.input;
    e.output += r.output;
    e.runs += 1;
    per.set(r.division, e);
  }
  const byMember = [...per.entries()]
    .map(([division, e]) => ({ division, ...e, share: Math.round((e.tokens / grand) * 1000) / 10 }))
    .sort((a, b) => b.tokens - a.tokens);

  const report: UsageReport = {
    range: key,
    since: since.toISOString(),
    runs: rows.length,
    input: sum((r) => r.input),
    output: sum((r) => r.output),
    reasoning: sum((r) => r.reasoning),
    cacheRead: sum((r) => r.cacheRead),
    byMember,
    rows,
  };
  cache.set(key, { at: Date.now(), report });
  return report;
}
