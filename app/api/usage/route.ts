import { NextRequest } from "next/server";
import { getUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const range = req.nextUrl.searchParams.get("range") ?? "7d";
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  return Response.json(getUsage(range, fresh));
}
