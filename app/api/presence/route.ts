import { NextRequest } from "next/server";
import { getPresence, setPresence } from "@/lib/db";
import { listDivisions } from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLACES = ["desk", "meeting", "lounge", "pantry", "musholla"] as const;

export async function GET(req: NextRequest) {
  const division = req.nextUrl.searchParams.get("division") ?? "";
  if (!listDivisions().some((d) => d.id === division)) {
    return Response.json({ ok: false, error: "unknown division" }, { status: 400 });
  }
  return Response.json({ ok: true, division, place: getPresence(division) });
}

export async function POST(req: NextRequest) {
  const { division, place } = (await req.json()) as { division: string; place: string };
  if (!division || !(PLACES as readonly string[]).includes(place)) {
    return Response.json({ ok: false, error: "need {division, place: desk|meeting}" }, { status: 400 });
  }
  if (!listDivisions().some((d) => d.id === division)) {
    return Response.json({ ok: false, error: "unknown division" }, { status: 400 });
  }
  setPresence(division, place);
  return Response.json({ ok: true, division, place });
}
