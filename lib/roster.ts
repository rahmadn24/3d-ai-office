import fs from "node:fs";
import path from "node:path";

/** Full member id, e.g. "gilang" (lead) or "sari-riko". Leads live at
 *  agents/<div>/, members at agents/<div>/members/<name>/. */
export function memberPath(id: string): string {
  const dash = id.indexOf("-");
  if (dash === -1) return path.join(process.cwd(), "agents", id);
  return path.join(process.cwd(), "agents", id.slice(0, dash), "members", id.slice(dash + 1));
}

export function memberWorkspace(id: string): string {
  return path.join(memberPath(id), "workspace");
}

/** Division group id for a member id ("sari-riko" -> "sari", "gilang" -> "gilang"). */
export function divisionOf(id: string): string {
  const dash = id.indexOf("-");
  return dash === -1 ? id : id.slice(0, dash);
}

export interface RosterMember {
  id: string;
  division: string;
  name: string;
  role: string;
}

function parseTitle(systemMd: string, fallback: string): { name: string; role: string } {
  const first = systemMd.split("\n")[0] ?? "";
  const m = first.replace(/^#\s*/, "").split(/—|-/).map((s) => s.trim());
  return { name: m[0] || fallback, role: m[1] || "" };
}

/** Every runnable member: leads first per division, then alphabetical. */
export function listRoster(): RosterMember[] {
  const root = path.join(process.cwd(), "agents");
  if (!fs.existsSync(root)) return [];
  const out: RosterMember[] = [];
  const divisions = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && fs.existsSync(path.join(root, e.name, "SYSTEM.md")))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const div of divisions) {
    const divPath = path.join(root, div.name);
    const leadMd = fs.readFileSync(path.join(divPath, "SYSTEM.md"), "utf-8");
    const lead = parseTitle(leadMd, div.name);
    out.push({ id: div.name, division: div.name, ...lead });
    const membersDir = path.join(divPath, "members");
    if (!fs.existsSync(membersDir)) continue;
    const members = fs
      .readdirSync(membersDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(membersDir, e.name, "SYSTEM.md")))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const m of members) {
      const md = fs.readFileSync(path.join(membersDir, m.name, "SYSTEM.md"), "utf-8");
      const t = parseTitle(md, m.name);
      out.push({ id: `${div.name}-${m.name}`, division: div.name, ...t });
    }
  }
  return out;
}
