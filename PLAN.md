# KANTOR-AI — Plan & Architecture (personal self-hosted build)

> Inspired by lembur.id ("Lu tidur, AI lembur"). Single user, own VPS, no commercial/licensing machinery.
> Stack: Next.js + TypeScript. Agent runtime: **OpenCode** (`opencode run`, one-shot per wake).
> Timezone: Asia/Jakarta. Night shift default 22:00–06:00 (configurable).

## 1. How it works (the loop)

1. System cron hits `/api/cron/tick` every 5 min.
2. Scheduler wakes the division whose time has come (skip if no inbox work).
3. Runner shells out to `opencode run` with that division's prompt + workspace.
4. Agent writes proposals to `Hasil/` and appends machine-readable requests to `decisions.json`.
5. Tick parses `decisions.json` → `pending_decisions` table. **Agents can never act directly.**
6. 07:00: dashboard + one Telegram digest. You tap Setuju / Pilih / Revisi.
7. Next tick feeds your answers back. Approved items execute via `tools-gateway.ts` only.

## 2. Architecture

```
karyawan-online/
  app/
    kantor/              # live office map (SVG desks, status dots, drawer per agent)
    dashboard/           # 07:00 view: decision queue + run timeline + suggestions
    api/
      cron/tick/route.ts # scheduler entry
      decisions/route.ts # approve / reject / revise
      status/route.ts     # office map + dashboard polling (or SSE later)
      runs/route.ts       # night logs
  agents/<divisi>/
    SYSTEM.md            # role prompt, locked rules reference
    opencode.json        # model + permission deny-list for this division
    workspace/           # inbox/ Hasil/ decisions.json (per-division working dir)
  lib/
    runner.ts            # builds prompt, calls `opencode run`, parses decisions.json
    scheduler.ts         # wake times, night window, skip-if-idle
    tools-gateway.ts     # ONLY path for real side effects (money/post/delete/PII)
    ledger.ts            # append-only cashbook; agents append, never edit
    notify.ts            # Telegram digest
    validators.ts        # deterministic checks (totals, title rules, price match)
  data/
    kantor.db            # sqlite: runs, pending_decisions, ledger, settings
```

### 2.1 Division = folder convention

Each division is just a folder: `SYSTEM.md` (who you are, what to check, what to output),
`opencode.json` (model tier + tool permissions), `workspace/` (its files). Adding a
division = copying `agents/_template/`. Builder division scaffolds this by interview.

### 2.2 Guardrails (code, not prompts) — `tools-gateway.ts`

Deny-by-default. Four locked classes, mirroring lembur.id, require a matching
`approved` decision row or the call is rejected even if the model insists:

| Class | Examples | Approver |
|---|---|---|
| `money` | pay bill, change price, discount, financeiro classify-ambiguous | you |
| `outbound` | post, email, customer chat, publish listing/site | you |
| `delete` | files, data, accounts | you |
| `pii` | customer name/phone/address leaving the workspace | you |

OpenCode-side: each division `opencode.json` denies `bash` outside workspace and denies
networked send tools; the gateway is the only executor of approved side effects.

### 2.3 Scheduler

`wake_times` per division (defaults below), night window 22:00–06:00, `skip_if_idle`
(inbox empty → don't wake, don't burn tokens), `runs` row per wake with status
`ok | needs_you | failed`. Day mode optional later.

### 2.4 Office map (`app/kantor`)

SVG night-office scene, one desk per enabled division + owner chair. Status dots derived
from scheduler + runs: gray asleep · amber pulsing working · red needs-you · green done.
Click desk → drawer (tonight's files, decisions, logs). Poll `/api/status` every 10s.

## 3. Division roster — what to build, what each handles

Model tiers: `eco` (cheap, high-volume) vs `pro` (reasoning, money/customer-facing).
Suggested Jakarta wake times assume 22:00–06:00 window.

| # | Division | Schedule | Tier | Inputs (inbox/) | Jobs handled | Deterministic tools | Always asks you |
|---|---|---|---|---|---|---|---|
| 1 | **Bima** — Sales & CS | 22:10 | eco | marketplace export CSV | daily order recap; draft buyer replies; promo proposals from sales dips | CSV totals calculator (never AI-estimated) | send reply, promo launch |
| 2 | **Sari** — Sosmed | 23:40 | eco | content pillars, past performance | 10 content ideas + reasons; scripts; carousel copy; weekly posting schedule | brief checklist validator | which ideas, approve-to-post |
| 3 | **Gilang** — Quotes & invoices | 01:15 | pro | briefs, price list | quote PDFs (auto-numbered); invoices; receivables + late-payer reminders | quote PDF gen, totals from calculator | any price cut / discount (e.g. budget < pricelist) |
| 4 | **Nadia** — Catalog & listing | 02:30 | eco | product photos + specs | Shopee/TikTok titles, descriptions, variants | title validator: length, blocked-word list, price-vs-pricelist match | publish listing |
| 5 | **Laras** — Finance | 04:00 | pro | receipt photos, bank mutation CSV | receipts+mutations → cashbook; monthly P&L; bill-due reminders | append-only ledger writer, P&L builder | pay, ambiguous classification |
| 6 | **Dimas** — Web & apps | 05:20 | pro | site repo/folder | tidy landing pages; mobile+desktop screenshots; broken-link/scan; stage preview | screenshot capture, link checker, build | **Terbitkan** (publish gate) |
| 7 | **Raka** — Ads | 03:10 | eco | ad-platform exports | spend/report recap; ROAS calc; budget shift proposals | spend aggregator, ROAS calc | budget changes (money) |
| 8 | **Dewi** — Admin & stock | 00:20 | eco | stock sheet, expense notes | stock recap; low-stock alerts; proposed shopping list; expense log | sheet updater, expense appender | purchase approval (money) |
| 9 | **Builder** — office manager | on-demand | pro | your chat | add division (interview → scaffold folder); change schedules; office appearance; run updates | scaffolder, config writer | structural changes |

Helper pattern per division: `workspace/inbox/` (you or other agents drop work),
`workspace/Hasil/` (proposals), `workspace/decisions.json` (machine-readable asks).
Optional later: mount one Google Drive folder as `inbox/`/`Hasil/` mirror.

## 4. Build phases

- **P0 thin slice (days):** scaffold + SQLite (`runs`, `pending_decisions`, `ledger`) +
  runner (`opencode run` wrapper) + **1 division (Gilang**, best demo of money-guardrail) +
  approve flow. Exit: one wake → one decision card → approve → executed via gateway.
- **P1 roster:** remaining 8 divisions as folders; enable/disable checklist; `_template/` + Builder scaffolding.
- **P2 night OS:** scheduler (window, wake times, skip-if-idle) + run timeline + office map v1 (static cozy scene, live dots) + Telegram 07:00 digest.
- **P3 money & publish:** ledger UI + P&L view; Dimas staging + Terbitkan gate; receivables reminders.
- **P4 VPS & upkeep:** systemd + cron, nightly SQLite backup, `install.sh`, update via `git pull` (never overwrites `data/` or edited prompts). Office map polish (animations).

## 5. Explicitly out of scope (personal use)

Kit licensing/purchase codes, payments, multi-user, WhatsApp Business (Telegram instead),
Google Drive v1 (local folders first).

## 6. Decisions needed from you (during build)
1. Which business should the demo data model? (generic placeholders vs your real shop)
2. Telegram bot for digest — create when we reach P2 (10 min, free).
3. Model routing per division (which of your 9router models = eco vs pro).
4. First division for P0: Gilang (recommended) or other?

## 7. Polish backlog (after system done — agreed)

- 3D office beauty pass: kit-richer rooms (lounge/pantry/prayer/plant kit renders).
- Walker pathfinding: waypoint graph on zone aisles so avatars walk AROUND
  tables/counters instead of ghosting through them (currently straight-line lerp).
- Walk-cycle polish: leg swing / lean into turns.
- Office day-mode art check in daylight.
