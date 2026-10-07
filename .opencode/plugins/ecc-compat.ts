/**
 * ecc-compat — V2-compatible replacement for the `ecc-universal` npm plugin.
 *
 * Why this exists:
 * - The ECC docs (Option 1: npm package) tell users to put
 *   `"plugin": ["ecc-universal"]` in opencode.json.
 * - `ecc-universal@2.2.3` ships a V1-style plugin
 *   (`(input: PluginInput) => hooks`, importing `@opencode-ai/plugin`).
 * - OpenCode V2 expects `Plugin.define({ id, setup })` from `@opencode/plugin`,
 *   so the server fails every startup with:
 *   `PluginModule.LoadError: Plugin must export a default definition with an
 *    id and an effect or setup function.`
 * - This shim re-implements ECC's 8 custom tools + core hooks on the V2 API
 *   with zero npm dependencies (node builtins only). It deliberately does NOT
 *   import `@opencode/plugin`: `Plugin.define` is a passthrough, and the
 *   server only requires a default export shaped like `{ id, setup }`.
 */

import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const PLUGIN_ID = "ecc-compat"

function run(cmd: string, args: string[], cwd: string, timeoutMs = 60000): string {
  const out = execFileSync(cmd, args, {
    cwd,
    timeout: timeoutMs,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
  })
  return String(out)
}

function exists(cwd: string, rel: string): boolean {
  try {
    return fs.statSync(path.join(cwd, rel)).isFile()
  } catch {
    return false
  }
}

function detectPackageManager(cwd: string): string {
  if (exists(cwd, "bun.lockb") || exists(cwd, "bun.lock")) return "bun"
  if (exists(cwd, "pnpm-lock.yaml")) return "pnpm"
  if (exists(cwd, "yarn.lock")) return "yarn"
  return "npm"
}

function detectFormatter(cwd: string, ext: string): string | null {
  if (exists(cwd, "biome.json") || exists(cwd, "biome.jsonc")) return "biome"
  if (["ts", "tsx", "js", "jsx", "json", "css", "md"].includes(ext)) {
    if (exists(cwd, ".prettierrc") || exists(cwd, ".prettierrc.json") || exists(cwd, "prettier.config.js"))
      return "prettier"
    return "prettier"
  }
  if (ext === "py") return "black"
  if (ext === "go") return "gofmt"
  if (ext === "rs") return "rustfmt"
  if (ext === "swift") return "swift-format"
  return null
}

function detectLinter(cwd: string): string {
  if (exists(cwd, "biome.json") || exists(cwd, "biome.jsonc")) return "biome"
  if (exists(cwd, ".eslintrc") || exists(cwd, ".eslintrc.json") || exists(cwd, "eslint.config.js")) return "eslint"
  if (exists(cwd, ".golangci.yml") || exists(cwd, ".golangci.yaml")) return "golangci-lint"
  if (exists(cwd, "pyproject.toml") || exists(cwd, "setup.cfg")) return "ruff"
  return "eslint"
}

const SAFE_GIT_REF = /^[A-Za-z0-9._/-]+$/

function isSafeRef(ref: string): boolean {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 200) return false
  if (!SAFE_GIT_REF.test(ref)) return false
  if (ref.startsWith("-") || ref.startsWith(".") || ref.startsWith("/")) return false
  if (ref.includes("..") || ref.includes("//")) return false
  return true
}

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/g },
  { name: "github-token", re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "private-key", re: /-----BEGIN (?:RSA )?PRIVATE KEY-----/g },
  { name: "generic-secret", re: /(api[_-]?key|secret|token)\s*[:=]\s*['"][^'"]{8,}['"]/gi },
]

function redactSecrets(text: string): { text: string; hits: string[] } {
  const hits: string[] = []
  let out = text
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(out)) hits.push(p.name)
    p.re.lastIndex = 0
    out = out.replace(p.re, "[REDACTED]")
  }
  return { text: out, hits }
}

function ok(data: unknown): { content: string } {
  return { content: typeof data === "string" ? data : JSON.stringify(data, null, 2) }
}

export default {
  id: PLUGIN_ID,

  async setup(ctx) {
    const projectDir =
      ctx.location?.project?.directory ?? ctx.location?.directory ?? process.cwd()

    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "ecc", description: "ECC compatibility tools (V2 port)" })

      editor.add({
        name: "run_tests",
        description:
          "Run the test suite with optional coverage, watch mode, or specific test patterns. Detects package manager and returns the exact command to run.",
        input: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Test file pattern or test name" },
            coverage: { type: "boolean", description: "Run with coverage (default false)" },
            watch: { type: "boolean", description: "Watch mode (default false)" },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (input) => {
          const args = input as { pattern?: string; coverage?: boolean; watch?: boolean }
          const pm = detectPackageManager(projectDir)
          const cmd = pm === "npm" ? [pm, "run", "test"] : [pm, "test"]
          const extra: string[] = []
          if (args.coverage) extra.push("--coverage")
          if (args.watch) extra.push("--watch")
          if (args.pattern) extra.push(args.pattern)
          if (extra.length > 0) {
            if (pm === "npm") cmd.push("--")
            cmd.push(...extra)
          }
          return ok({ success: true, packageManager: pm, command: cmd.join(" ") })
        },
      })

      editor.add({
        name: "check_coverage",
        description:
          "Check test coverage against a threshold by reading coverage reports (coverage/coverage-summary.json, coverage/coverage-final.json).",
        input: {
          type: "object",
          properties: {
            threshold: { type: "number", description: "Minimum coverage % required (default 80)" },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (input) => {
          const threshold = (input as { threshold?: number }).threshold ?? 80
          const candidates = ["coverage/coverage-summary.json", "coverage/coverage-final.json"]
          for (const rel of candidates) {
            const full = path.join(projectDir, rel)
            if (!fs.existsSync(full)) continue
            try {
              const data = JSON.parse(fs.readFileSync(full, "utf-8"))
              const total = data.total ?? data
              const pct = (v: unknown) => (typeof v === "object" && v !== null ? (v as { pct?: number }).pct : v)
              const summary = {
                lines: pct(total.lines),
                statements: pct(total.statements),
                functions: pct(total.functions),
                branches: pct(total.branches),
              }
              const values = Object.values(summary).filter((v): v is number => typeof v === "number")
              const min = values.length ? Math.min(...values) : null
              return ok({
                success: true,
                report: rel,
                summary,
                threshold,
                passed: min === null ? null : min >= threshold,
              })
            } catch (err) {
              return ok({ success: false, report: rel, error: String(err) })
            }
          }
          return ok({ success: false, message: "No coverage report found", searched: candidates })
        },
      })

      editor.add({
        name: "security_audit",
        description:
          "Scan staged/changed files for leaked secrets and report dependency-audit guidance. Never prints secret values.",
        input: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["all", "dependencies", "secrets"],
              description: "Audit type (default all)",
            },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (input) => {
          const type = (input as { type?: string }).type ?? "all"
          const findings: Array<{ file: string; kinds: string[] }> = []
          if (type === "all" || type === "secrets") {
            let files: string[] = []
            try {
              files = run("git", ["diff", "--name-only", "HEAD"], projectDir)
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
            } catch {
              files = []
            }
            for (const f of files.slice(0, 50)) {
              try {
                const full = path.join(projectDir, f)
                if (!fs.statSync(full).isFile() || fs.statSync(full).size > 512 * 1024) continue
                const content = fs.readFileSync(full, "utf-8")
                const { hits } = redactSecrets(content)
                if (hits.length) findings.push({ file: f, kinds: [...new Set(hits)] })
              } catch {
                continue
              }
            }
          }
          const pm = detectPackageManager(projectDir)
          return ok({
            success: findings.length === 0,
            secrets: { checked: type === "all" || type === "secrets", findings },
            dependencies:
              type === "all" || type === "dependencies"
                ? { guidance: `Run \`${pm} audit\` (or \`npm audit --json\`) for dependency vulnerabilities.` }
                : { skipped: true },
          })
        },
      })

      editor.add({
        name: "format_code",
        description:
          "Detect the formatter for a file and return the exact command to run (biome, prettier, black, gofmt, rustfmt, swift-format).",
        input: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Path of the file to format" },
            formatter: {
              type: "string",
              enum: ["biome", "prettier", "black", "gofmt", "rustfmt", "swift-format"],
              description: "Formatter override",
            },
          },
          required: ["filePath"],
          additionalProperties: false,
        },
        execute: async (input) => {
          const { filePath, formatter } = input as { filePath: string; formatter?: string }
          const ext = (filePath.split(".").pop() ?? "").toLowerCase()
          const detected = formatter ?? detectFormatter(projectDir, ext)
          if (!detected) return ok({ success: false, message: `No formatter for .${ext} files` })
          const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
          const commands: Record<string, string> = {
            biome: `biome format --write ${q(filePath)}`,
            prettier: `prettier --write ${q(filePath)}`,
            black: `black ${q(filePath)}`,
            gofmt: `gofmt -w ${q(filePath)}`,
            rustfmt: `rustfmt ${q(filePath)}`,
            "swift-format": `swift-format format -i ${q(filePath)}`,
          }
          return ok({ success: true, formatter: detected, command: commands[detected] })
        },
      })

      editor.add({
        name: "lint_check",
        description: "Detect the linter and return the command for check/fix runs.",
        input: {
          type: "object",
          properties: {
            target: { type: "string", description: "File or directory to lint (default .)" },
            fix: { type: "boolean", description: "Auto-fix mode (default false)" },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (input) => {
          const { target, fix } = input as { target?: string; fix?: boolean }
          const t = target || "."
          const linter = detectLinter(projectDir)
          const commands: Record<string, string> = {
            biome: fix ? `biome check --write ${t}` : `biome check ${t}`,
            eslint: fix ? `eslint --fix ${t}` : `eslint ${t}`,
            ruff: fix ? `ruff check --fix ${t}` : `ruff check ${t}`,
            "golangci-lint": `golangci-lint run ${t}`,
          }
          return ok({ success: true, linter, fixMode: fix ?? false, command: commands[linter] })
        },
      })

      editor.add({
        name: "git_summary",
        description: "Git branch, status, recent commits, and diff stats for the active repository.",
        input: {
          type: "object",
          properties: {
            depth: { type: "number", description: "Recent commits to include (default 5, max 50)" },
            baseBranch: { type: "string", description: "Base branch for diff stats (default main)" },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (input) => {
          const { depth, baseBranch } = input as { depth?: number; baseBranch?: string }
          const n = Number.isInteger(depth) && (depth as number) > 0 ? Math.min(depth as number, 50) : 5
          const base = baseBranch && isSafeRef(baseBranch) ? baseBranch : "main"
          try {
            const branch = run("git", ["branch", "--show-current"], projectDir).trim()
            const status = run("git", ["status", "--short"], projectDir).trim()
            const log = run(
              "git",
              ["log", `-${n}`, "--pretty=format:%h %s (%an)"],
              projectDir,
            ).trim()
            let diffStat = ""
            try {
              diffStat = run("git", ["diff", "--stat", base], projectDir).trim()
            } catch {
              diffStat = `(no diff available against ${base})`
            }
            return ok({ success: true, branch, status, recentCommits: log, diffStat, baseBranch: base })
          } catch (err) {
            return ok({ success: false, error: String(err) })
          }
        },
      })

      editor.add({
        name: "changed_files",
        description: "List working-tree changed files as a tree with added (+), modified (~), deleted (-) indicators.",
        input: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              enum: ["all", "added", "modified", "deleted"],
              description: "Change-type filter (default all)",
            },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (input) => {
          const filter = (input as { filter?: string }).filter ?? "all"
          try {
            const porcelain = run("git", ["status", "--porcelain"], projectDir).trim()
            const rows = porcelain
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((line) => {
                const code = line.slice(0, 2)
                const file = line.slice(3).trim()
                const kind = code.includes("A") ? "added" : code.includes("D") ? "deleted" : "modified"
                return { file, kind }
              })
              .filter((r) => filter === "all" || r.kind === filter)
            const mark = { added: "+", modified: "~", deleted: "-" } as const
            const tree = rows.map((r) => `${r.file} (${mark[r.kind as keyof typeof mark]})`).join("\n")
            return ok({ success: true, count: rows.length, filter, tree: tree || "(no changes)" })
          } catch (err) {
            return ok({ success: false, error: String(err) })
          }
        },
      })

      editor.add({
        name: "dependency_analyzer",
        description: "Summarize project dependencies (counts, package manager, scripts) from package.json.",
        input: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["all", "outdated", "security", "unused"],
              description: "Analysis type (default all)",
            },
          },
          required: [],
          additionalProperties: false,
        },
        execute: async (input) => {
          const type = (input as { type?: string }).type ?? "all"
          const pkgFile = path.join(projectDir, "package.json")
          if (!fs.existsSync(pkgFile)) return ok({ success: false, message: "No package.json found" })
          const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf-8"))
          const deps = Object.keys(pkg.dependencies ?? {})
          const devDeps = Object.keys(pkg.devDependencies ?? {})
          const pm = detectPackageManager(projectDir)
          return ok({
            success: true,
            packageManager: pm,
            counts: { dependencies: deps.length, devDependencies: devDeps.length },
            scripts: Object.keys(pkg.scripts ?? {}),
            analysis: type,
            guidance:
              type === "all" || type === "outdated"
                ? `Run \`${pm === "npm" ? "npm outdated" : `${pm} outdated`}\` for versions.`
                : `Run \`${pm} audit\` for vulnerabilities.`,
            sample: { dependencies: deps.slice(0, 20), devDependencies: devDeps.slice(0, 20) },
          })
        },
      })
    })

    await ctx.session.hook("prompt", (event) => {
      const { text, hits } = redactSecrets(event.prompt.text ?? "")
      if (hits.length) {
        event.prompt.text = text
        event.metadata = { ...event.metadata, eccSecretsRedacted: hits.join(",") }
      }
    })
  },
}
