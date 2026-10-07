import { NextRequest } from "next/server";
import { orchestrate } from "@/lib/orchestrator";
import { runDivision } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1200;

// Fire-and-forget: agent runs take 10-30 min, far longer than any HTTP
// client should wait. We accept the wake, detach the work, and report
// progress through /api/status and the runs table.
export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get("agent");
  if (agent) {
    runDivision(agent).catch((err) => console.error(`[tick] manual ${agent} failed:`, String(err).slice(0, 200)));
    return Response.json({ ok: true, mode: "manual", agent, accepted: true });
  }
  orchestrate().catch((err) => console.error("[tick] orchestrated pass failed:", String(err).slice(0, 200)));
  return Response.json({ ok: true, mode: "orchestrated", accepted: true });
}
