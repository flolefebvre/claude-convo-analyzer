// Seed the local SQLite DB with realistic FAKE data — for screenshots / demos.
//
// Strategy (faithful to the real pipeline): generate fake Claude Code JSONL
// transcripts into a throwaway logs root, then run the genuine `refresh()` into
// the real `./data/analyzer.db`. This routes every byte through the actual
// parser + cost engine, so the seeded rows are guaranteed consistent with what
// the app reads — no hand-poked SQLite rows that could drift from the schema.
//
// The fake logs go to a temp dir that is removed afterwards; only the DB rows
// persist. Deterministic ids make re-running idempotent (refresh skips unchanged
// conversations and re-writes changed ones — never duplicates).
//
// Run with:  pnpm dlx tsx scripts/seed-fake-data.ts
//
// NOTE: clicking "Refresh" in the running app re-scans your REAL
// ~/.claude/projects and will replace this fake data. That's expected — this
// seed is only for producing demo screenshots.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_DB_PATH } from "@/core/db";
import { refresh } from "@/core/refresh";

// ── Deterministic PRNG (LCG) so the seed is reproducible run-to-run ──────────
let _seed = 0x2f6e2b1;
function rand(): number {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
}
function int(min: number, max: number): number {
  return Math.floor(min + rand() * (max - min + 1));
}
function pick<T>(arr: readonly T[]): T {
  return arr[int(0, arr.length - 1)];
}
function chance(p: number): boolean {
  return rand() < p;
}

// ── Generic demo content (safe for a public README) ──────────────────────────
const PROJECTS = [
  { path: "/home/dev/acme-api", repo: "acme/acme-api" },
  { path: "/home/dev/web-dashboard", repo: "acme/web-dashboard" },
  { path: "/home/dev/billing-service", repo: "acme/billing-service" },
  { path: "/home/dev/mobile-app", repo: "acme/mobile-app" },
  { path: "/home/dev/data-pipeline", repo: "acme/data-pipeline" },
  { path: "/home/dev/docs-site", repo: "acme/docs-site" },
] as const;

const TITLES = [
  "Add pagination to the users endpoint",
  "Fix flaky integration tests",
  "Refactor auth middleware",
  "Implement dark mode toggle",
  "Migrate database to Postgres 16",
  "Add rate limiting to the API",
  "Optimize the dashboard query",
  "Wire up Stripe webhooks",
  "Build the CSV export feature",
  "Set up CI pipeline with caching",
  "Debug the memory leak in the worker",
  "Add end-to-end checkout tests",
  "Generate OpenAPI spec from routes",
  "Improve cold-start latency",
  "Add retry logic to the queue consumer",
  "Redesign the settings page",
  "Audit and fix N+1 queries",
  "Add feature flags to the rollout",
  "Containerize the service",
  "Write the onboarding docs",
  "Upgrade to React 19",
  "Add structured logging",
  "Fix the timezone bug in reports",
  "Implement soft deletes",
  "Add search to the docs site",
] as const;

// The searchable text (issue #45): prompts and replies are what the full-text
// index covers, so the demo database needs enough VARIETY for a search to show
// several distinct matches in one conversation. Deliberately generic
// acme-flavoured engineering chatter — obviously invented, never anything that
// could read as a real conversation.
const PROMPTS = [
  "Can you help me implement this feature end to end?",
  "There's a bug here — can you track it down and fix it?",
  "Please refactor this module and add tests.",
  "Let's get this working and then clean it up.",
  "Walk me through the changes and apply them.",
  "The staging deploy is timing out — where is the latency coming from?",
  "Add pagination to the users endpoint, then update the OpenAPI spec.",
  "Why does the checkout flow drop the cart on a slow network?",
  "Cache invalidation is firing twice per request — dig into it.",
  "Migrate the reports job to the new queue consumer and keep retries.",
  "Review the auth middleware for anything that leaks a session token.",
  "Split this Postgres migration so it can run without downtime.",
  "The dashboard query is slow after the last release — profile it.",
  "Write the onboarding docs for the billing service, with examples.",
  "Turn the flaky integration tests green without weakening them.",
] as const;

/** Assistant turn bodies — same purpose and same "obviously fake" rule. */
const ASSISTANT_REPLIES = [
  "Working on it.",
  "Reading the module first so the change lands in one place.",
  "The slow path is the dashboard query — it scans before it filters.",
  "Cache invalidation runs on both the write and the read path; removing one.",
  "Added pagination to the users endpoint and regenerated the OpenAPI spec.",
  "The auth middleware refreshes the session token but never rotates it.",
  "Splitting the Postgres migration into an additive step and a cleanup step.",
  "Tests are green; the flake came from a shared fixture, not from timing.",
  "Retries are back on the queue consumer, capped at five attempts.",
  "Wrote the onboarding docs with a worked billing example.",
  "That timeout is the staging deploy waiting on the migration lock.",
  "Refactored the module and covered the new branch with tests.",
] as const;

/** Sub-agent turn bodies (a sub-agent reports back, it does not converse). */
const SUB_AGENT_REPLIES = [
  "Sub-agent working.",
  "Swept the repo: the endpoint is defined once, in the users router.",
  "Found three call sites that invalidate the cache on the read path.",
  "The migration touches two tables; only one is written during the deploy.",
  "No session token is logged anywhere in the auth middleware.",
] as const;

const MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "claude-haiku-4-5-20251001",
] as const;

const SKILLS = ["tdd", "orchestrate", "commit", "code-review", "fresh-review"] as const;
const SUBAGENT_TYPES = ["Explore", "Plan", "general-purpose"] as const;

/**
 * The task a sub-agent is spawned with, one per agent type. The SAME string is
 * the parent's `Agent` tool_use `input.prompt` AND the first record of the
 * sub-agent's own transcript — that is how a real log reads. Keyed by the
 * already-picked agent type rather than picked at random, so adding it costs no
 * draw from the PRNG and the rest of the seeded corpus stays byte-identical.
 */
const SUBAGENT_PROMPTS: Record<(typeof SUBAGENT_TYPES)[number], string> = {
  Explore: "Sweep the repo and report where this behaviour is implemented.",
  Plan: "Draft the implementation plan for this change, smallest slices first.",
  "general-purpose": "Investigate this and report back with what you find.",
};
const BASH_CMDS = ["pnpm test", "pnpm lint", "git status", "pnpm build", "npm run typecheck"] as const;
const READ_FILES = ["src/index.ts", "src/server.ts", "README.md", "src/db.ts", "package.json"] as const;

const CC_VERSION = "2.1.185";

// Base "now" for the demo timeline. Fixed by default (deterministic — never an
// implicit `Date.now()`), but slidable with `--now=<ISO>` or `--now=today` so
// the seeded three weeks can be made to land inside a range that ends today —
// the Trends page's default 30-day window shows nothing otherwise.
const NOW = resolveNow();

function resolveNow(): number {
  const flag = "--now=";
  const arg = process.argv.find((a) => a.startsWith(flag))?.slice(flag.length);
  if (arg === undefined) return Date.parse("2026-06-22T17:00:00.000Z");
  if (arg === "today") {
    const today = new Date();
    today.setHours(17, 0, 0, 0);
    return today.getTime();
  }
  const parsed = Date.parse(arg);
  if (Number.isNaN(parsed)) {
    throw new Error(`--now: expected an ISO instant or "today", got "${arg}"`);
  }
  return parsed;
}
const DAY = 86_400_000;

let uuidCounter = 0;
function uid(prefix: string): string {
  uuidCounter += 1;
  return `${prefix}-${uuidCounter.toString(36)}`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
};

function makeUsage(scale: number): Usage {
  // Real Claude Code logs always carry integer token counts, so a non-integer
  // `scale` must not leak fractions into the output. Round the component, then
  // derive the sum from it — that keeps `cache_creation_input_tokens` exactly
  // equal to the ephemeral breakdown, which rounding the sum separately would
  // not.
  const create5m = Math.round(int(800, 18_000) * scale);
  const create1h = chance(0.3) ? int(0, 4_000) : 0;
  return {
    input_tokens: int(150, 2_200),
    output_tokens: int(300, 4_500),
    cache_creation_input_tokens: create5m + create1h,
    cache_read_input_tokens: int(4_000, 160_000),
    cache_creation: {
      ephemeral_5m_input_tokens: create5m,
      ephemeral_1h_input_tokens: create1h,
    },
  };
}

type SubAgent = { agentId: string; lines: string[] };

// ── API errors (issue #47) ──────────────────────────────────────────────────
// Turns the API itself failed on: the log marks them `isApiErrorMessage` with
// an `apiErrorStatus`, and the turn's only content is the `API Error: …` line.
// They happen on the main thread and inside sub-agents alike, which is exactly
// what the list badge and the panel's error section have to surface.

const API_ERRORS = [
  { status: "overloaded_error", text: "API Error: Overloaded" },
  { status: "rate_limit_error", text: "API Error: 429 rate limit exceeded" },
  { status: "timeout_error", text: "API Error: Request timed out after 600s" },
  { status: "api_error", text: "API Error: 500 internal server error" },
] as const;

/**
 * One failed assistant turn. `agent` marks it as a SUB-AGENT record, carrying
 * the real log shape (`isSidechain` + `agentId` + `attributionAgent`) every
 * line of a `subagents/agent-<id>.jsonl` file has. A failed turn still bills a
 * little input, and no output.
 */
function apiErrorTurn(
  ms: number,
  cwd: string,
  model: string,
  agent?: { agentId: string; agentType: string },
): string {
  const failure = pick(API_ERRORS);
  const rec: Record<string, unknown> = {
    type: "assistant",
    uuid: uid("a"),
    requestId: uid("req"),
    timestamp: iso(ms),
    cwd,
    gitBranch: "main",
    version: CC_VERSION,
    isApiErrorMessage: true,
    apiErrorStatus: failure.status,
    message: {
      id: uid("msg"),
      role: "assistant",
      model,
      content: [{ type: "text", text: failure.text }],
      usage: {
        input_tokens: int(80, 900),
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: int(2_000, 40_000),
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 0,
        },
      },
    },
  };
  if (agent !== undefined) {
    rec.isSidechain = true;
    rec.agentId = agent.agentId;
    rec.attributionAgent = agent.agentType;
  }
  return JSON.stringify(rec);
}

/** Build one main-thread assistant turn (optionally with tool_use blocks). */
function assistantTurn(
  ms: number,
  cwd: string,
  model: string,
  opts: { skill?: string; toolUses?: object[]; scale?: number } = {},
): string {
  const content: object[] = [{ type: "text", text: pick(ASSISTANT_REPLIES) }];
  if (opts.toolUses) content.push(...opts.toolUses);
  const rec: Record<string, unknown> = {
    type: "assistant",
    uuid: uid("a"),
    requestId: uid("req"),
    timestamp: iso(ms),
    cwd,
    gitBranch: "main",
    version: CC_VERSION,
    message: {
      id: uid("msg"),
      role: "assistant",
      model,
      content,
      usage: makeUsage(opts.scale ?? 1),
    },
  };
  if (opts.skill) rec.attributionSkill = opts.skill;
  return JSON.stringify(rec);
}

/**
 * One prompt record. `agent` marks it as a SUB-AGENT prompt — the task handed
 * to the sub-agent, which is the FIRST line of every real
 * `subagents/agent-<id>.jsonl` file: sidechain shape (`isSidechain` +
 * `agentId`) and no `permissionMode`, which only a main-thread prompt carries.
 */
function userPrompt(
  ms: number,
  cwd: string,
  text: string,
  /** Set on a RESUMED session's first prompt: the parent session's record it
   *  continues from. `refresh()` resolves it into a `continued_from` link. */
  parentUuid?: string,
  agent?: { agentId: string },
): string {
  const rec: Record<string, unknown> = {
    type: "user",
    uuid: uid("u"),
    timestamp: iso(ms),
    cwd,
    gitBranch: "main",
    version: CC_VERSION,
    message: { role: "user", content: text },
  };
  if (agent === undefined) rec.permissionMode = "default";
  else {
    rec.isSidechain = true;
    rec.agentId = agent.agentId;
  }
  if (parentUuid !== undefined) rec.parentUuid = parentUuid;
  return JSON.stringify(rec);
}

/**
 * One `tool_result` carrier record. `agent` marks it as a SUB-AGENT record,
 * carrying the real log shape (`isSidechain` + `agentId`) every line of a
 * `subagents/agent-<id>.jsonl` file has — same as {@link apiErrorTurn}.
 */
function toolResult(
  ms: number,
  cwd: string,
  toolUseId: string,
  result: unknown,
  isError = false,
  agent?: { agentId: string },
): string {
  const rec: Record<string, unknown> = {
    type: "user",
    uuid: uid("u"),
    timestamp: iso(ms),
    cwd,
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: toolUseId, content: "ok", is_error: isError },
      ],
    },
    toolUseResult: result,
  };
  if (agent !== undefined) {
    rec.isSidechain = true;
    rec.agentId = agent.agentId;
  }
  return JSON.stringify(rec);
}

// ── The tool palette ────────────────────────────────────────────────────────
// The Tools page reads three things off a tool call: how often it runs, how
// often it errors, and how many characters it returns. So each kind here has a
// weight, a failure rate, and a result-size band — a `Read` of a big file
// floods the context, an `Edit` barely registers, an MCP server fails more than
// a built-in does.

const GREP_PATTERNS = ["TODO", "createUser", "useEffect\\(", "process.env", "async function"] as const;
const MCP_QUERIES = ["open bugs", "release blockers", "stale PRs"] as const;

const TOOL_KINDS = [
  { name: "Read", weight: 9, errorChance: 0.02, min: 400, max: 42_000,
    input: () => ({ file_path: pick(READ_FILES) }) },
  { name: "Bash", weight: 8, errorChance: 0.13, min: 40, max: 6_000,
    input: () => ({ command: pick(BASH_CMDS) }) },
  { name: "Edit", weight: 6, errorChance: 0.08, min: 30, max: 320,
    input: () => ({ file_path: pick(READ_FILES) }) },
  { name: "Grep", weight: 5, errorChance: 0.04, min: 80, max: 14_000,
    input: () => ({ pattern: pick(GREP_PATTERNS) }) },
  { name: "Skill", weight: 3, errorChance: 0.02, min: 600, max: 9_000,
    input: () => ({ skill: pick(SKILLS) }) },
  { name: "mcp__github__create_issue", weight: 2, errorChance: 0.17, min: 200, max: 1_400,
    input: () => ({ title: pick(TITLES), repository: "acme/acme-api" }) },
  { name: "mcp__linear__search_issues", weight: 2, errorChance: 0.09, min: 300, max: 22_000,
    input: () => ({ query: pick(MCP_QUERIES) }) },
] as const;

const TOTAL_TOOL_WEIGHT = TOOL_KINDS.reduce((sum, k) => sum + k.weight, 0);

/** Pick a tool kind by weight, so built-ins dominate as they do in real logs. */
function pickToolKind(): (typeof TOOL_KINDS)[number] {
  let roll = rand() * TOTAL_TOOL_WEIGHT;
  for (const kind of TOOL_KINDS) {
    roll -= kind.weight;
    if (roll <= 0) return kind;
  }
  return TOOL_KINDS[0];
}

const RESULT_FILLER =
  "export function handler(req: Request) { const user = await lookup(req); return json(user); }\n";

const ERROR_MESSAGES = [
  "Error: command failed with exit code 1",
  "Error: ENOENT: no such file or directory",
  "Error: request failed (429 Too Many Requests)",
  "Error: string to replace not found in file",
  "Error: timed out after 120000ms",
] as const;

/** A result payload of roughly the kind's size band (or a short error message). */
function toolResultText(kind: (typeof TOOL_KINDS)[number], isError: boolean): string {
  if (isError) return pick(ERROR_MESSAGES);
  const size = int(kind.min, kind.max);
  return RESULT_FILLER.repeat(Math.ceil(size / RESULT_FILLER.length)).slice(0, size);
}

/** Build a sub-agent transcript file + the parent's spawn ledger tool_result. */
function spawnSubAgent(
  ms: number,
  cwd: string,
): { toolUse: object; ledgerResult: object; sub: SubAgent } {
  const agentId = uid("agent").replace("agent-", "");
  const toolUseId = uid("tu");
  const agentType = pick(SUBAGENT_TYPES);
  const subModel = pick(MODELS);

  // The sub-agent's own transcript — the source of truth for its tokens. Every
  // record in it carries the real sidechain shape (`isSidechain` + `agentId`),
  // and its assistant turns name the spawned agent via `attributionAgent`.
  //
  // It OPENS with the prompt the sub-agent was handed (issue #56), exactly as a
  // real file does, then replies from five seconds later on.
  const prompt = SUBAGENT_PROMPTS[agentType];
  const subLines: string[] = [userPrompt(ms, cwd, prompt, undefined, { agentId })];
  let subTotal = 0;
  const turns = int(2, 5);
  for (let i = 0; i < turns; i++) {
    const turnMs = ms + 5_000 + i * 30_000;
    const u = makeUsage(0.6);
    const subKind = pickToolKind();
    const subToolUse = chance(0.6)
      ? { type: "tool_use", id: uid("tu"), name: subKind.name, input: subKind.input() }
      : null;
    const subText = pick(SUB_AGENT_REPLIES);
    subTotal +=
      u.input_tokens +
      u.output_tokens +
      u.cache_creation_input_tokens +
      u.cache_read_input_tokens;
    subLines.push(
      JSON.stringify({
        type: "assistant",
        uuid: uid("sa"),
        requestId: uid("sreq"),
        timestamp: iso(turnMs),
        cwd,
        gitBranch: "main",
        version: CC_VERSION,
        isSidechain: true,
        agentId,
        attributionAgent: agentType,
        resolvedModel: subModel,
        message: {
          id: uid("smsg"),
          role: "assistant",
          model: subModel,
          content: subToolUse === null
            ? [{ type: "text", text: subText }]
            : [{ type: "text", text: subText }, subToolUse],
          usage: u,
        },
      }),
    );
    // A sub-agent's turn can fail exactly like the main thread's.
    if (chance(0.06)) {
      subLines.push(
        apiErrorTurn(turnMs + 15_000, cwd, subModel, { agentId, agentType }),
      );
    }
    // Sub-agents call tools too, and the Tools page counts them — same friction.
    if (subToolUse !== null) {
      const isError = chance(subKind.errorChance);
      subLines.push(
        toolResult(
          turnMs + 5_000,
          cwd,
          subToolUse.id,
          toolResultText(subKind, isError),
          isError,
          { agentId },
        ),
      );
    }
  }

  const toolUse = {
    type: "tool_use",
    id: toolUseId,
    name: "Agent",
    input: { subagent_type: agentType, description: "investigate", prompt },
  };
  const ledgerResult = {
    agentId,
    agentType,
    resolvedModel: subModel,
    totalTokens: subTotal,
    totalToolUseCount: int(2, 8),
    totalDurationMs: int(8_000, 60_000),
    usage: makeUsage(0.6),
  };
  return { toolUse, ledgerResult, sub: { agentId, lines: subLines } };
}

/** Where a later session can pick this one up (`--resume`/fork): the record it
 *  would continue from, and when that happened. */
type ResumePoint = { uuid: string; ms: number };

type Conversation = {
  folder: string;
  sessionId: string;
  mainLines: string[];
  subAgents: SubAgent[];
  /** The point a continuation of this conversation attaches to. */
  resumePoint: ResumePoint;
};

function buildConversation(
  project: (typeof PROJECTS)[number],
  index: number,
  opts: {
    /** Makes this a CONTINUATION of an earlier session (issue #46): its first
     *  prompt carries that session's record as `parentUuid`, and it starts a few
     *  hours later. */
    resumeFrom?: ResumePoint;
    /** Overrides the random title — used so a family reads as one piece of work. */
    title?: string;
  } = {},
): Conversation {
  const cwd = project.path;
  const folder = cwd.replace(/\//g, "-");
  const sessionId = `seed-${folder.slice(1)}-${index}`;

  const start =
    opts.resumeFrom === undefined
      ? NOW - int(0, 21) * DAY - int(0, 18) * 3_600_000
      : opts.resumeFrom.ms + int(1, 8) * 3_600_000;
  let t = start;
  const lines: string[] = [];
  const subAgents: SubAgent[] = [];

  const title = opts.title ?? pick(TITLES);
  lines.push(JSON.stringify({ type: "ai-title", aiTitle: title }));
  lines.push(userPrompt(t, cwd, pick(PROMPTS), opts.resumeFrom?.uuid));

  // Most conversations have a dominant model; some are mixed.
  const dominant = pick(MODELS);
  const mixed = chance(0.35);
  const usesSkill = chance(0.6);
  const skill = usesSkill ? pick(SKILLS) : undefined;

  const turns = int(3, 9);
  for (let i = 0; i < turns; i++) {
    t += int(20_000, 240_000);
    const model = mixed && chance(0.4) ? pick(MODELS) : dominant;
    const toolUses: object[] = [];

    if (chance(0.7)) {
      const tuId = uid("tu");
      const kind = pickToolKind();
      const isError = chance(kind.errorChance);
      toolUses.push({ type: "tool_use", id: tuId, name: kind.name, input: kind.input() });
      lines.push(assistantTurn(t, cwd, model, { skill, toolUses }));
      t += int(2_000, 20_000);
      lines.push(toolResult(t, cwd, tuId, toolResultText(kind, isError), isError));
    } else {
      lines.push(assistantTurn(t, cwd, model, { skill }));
    }

    // The API occasionally fails a turn; Claude Code retries on the next one.
    if (chance(0.05)) {
      t += int(3_000, 15_000);
      lines.push(apiErrorTurn(t, cwd, model));
    }

    // Occasionally spawn a sub-agent.
    if (chance(0.22)) {
      t += int(10_000, 30_000);
      const { toolUse, ledgerResult, sub } = spawnSubAgent(t, cwd);
      lines.push(assistantTurn(t, cwd, dominant, { skill, toolUses: [toolUse] }));
      t += int(8_000, 40_000);
      lines.push(
        toolResult(t, cwd, (toolUse as { id: string }).id, ledgerResult),
      );
      subAgents.push(sub);
    }
  }

  // A PR link on some conversations.
  if (chance(0.4)) {
    lines.push(
      JSON.stringify({
        type: "pr-link",
        prNumber: int(10, 480),
        prUrl: `https://github.com/${project.repo}/pull/${int(10, 480)}`,
        prRepository: project.repo,
      }),
    );
  }

  // A turn-duration system record on most conversations.
  if (chance(0.7)) {
    lines.push(
      JSON.stringify({
        type: "system",
        subtype: "turn_duration",
        durationMs: int(45_000, 1_800_000),
        messageCount: turns * 2,
      }),
    );
  }

  return {
    folder,
    sessionId,
    mainLines: lines,
    subAgents,
    resumePoint: { uuid: lastAssistantUuid(lines), ms: t },
  };
}

/** The uuid of the conversation's LAST assistant record — what a `--resume`
 *  writes as its first prompt's `parentUuid`. */
function lastAssistantUuid(lines: readonly string[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const rec = JSON.parse(lines[i]) as { type?: string; uuid?: string };
    if (rec.type === "assistant" && typeof rec.uuid === "string") return rec.uuid;
  }
  throw new Error("conversation has no assistant record to resume from");
}

/**
 * Two continuation families (issue #46), so the seeded data exercises the
 * badge, the panel's family tree and the transcript banner:
 *
 *  - a FORKED family in the first project: a root sitting, two continuations of
 *    it, a continuation of the first one, and one resumed from ANOTHER project
 *    (a worktree — five members, depth 3, one cross-directory);
 *  - a plain two-sitting chain in the second project.
 *
 * Indices continue after the standalone conversations so their session ids —
 * and therefore the whole seed — stay deterministic run to run.
 */
function continuationFamilies(startIndex: number): Conversation[] {
  const forkProject = PROJECTS[0];
  const chainProject = PROJECTS[1];
  let i = startIndex;

  const root = buildConversation(forkProject, i++, {
    title: "Split the billing service out of the monolith",
  });
  const firstBranch = buildConversation(forkProject, i++, {
    resumeFrom: root.resumePoint,
    title: "Billing split — extract the invoice writer",
  });
  const secondBranch = buildConversation(forkProject, i++, {
    resumeFrom: root.resumePoint,
    title: "Billing split — try the event-sourced angle instead",
  });
  const deeper = buildConversation(forkProject, i++, {
    resumeFrom: firstBranch.resumePoint,
    title: "Billing split — migrate the last caller and delete the shim",
  });

  // Resumed from a git worktree of the same repo: Claude Code launches there in
  // its own directory, so the sitting belongs to a DIFFERENT Project (CONTEXT.md).
  const inWorktree = buildConversation(PROJECTS[2], i++, {
    resumeFrom: secondBranch.resumePoint,
    title: "Billing split — event-sourced spike, in a worktree",
  });

  const chainStart = buildConversation(chainProject, i++, {
    title: "Make the nightly export idempotent",
  });
  const chainEnd = buildConversation(chainProject, i++, {
    resumeFrom: chainStart.resumePoint,
    title: "Nightly export — finish the retry path",
  });

  return [
    root,
    firstBranch,
    secondBranch,
    deeper,
    inWorktree,
    chainStart,
    chainEnd,
  ];
}

// ── Generate, write to a throwaway logs root, and ingest ─────────────────────
async function main(): Promise<void> {
  const logsRoot = mkdtempSync(path.join(tmpdir(), "cca-seed-"));
  console.log(`Generating fake logs in ${logsRoot}`);

  let convoCount = 0;
  let subAgentCount = 0;
  // Spread ~30 conversations across the 6 projects.
  const total = 30;
  const conversations: Conversation[] = [];
  for (let i = 0; i < total; i++) {
    conversations.push(buildConversation(PROJECTS[i % PROJECTS.length], i));
  }
  conversations.push(...continuationFamilies(total));

  for (const convo of conversations) {
    const projectDir = path.join(logsRoot, convo.folder);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      path.join(projectDir, `${convo.sessionId}.jsonl`),
      convo.mainLines.join("\n") + "\n",
    );

    if (convo.subAgents.length > 0) {
      const subDir = path.join(projectDir, convo.sessionId, "subagents");
      mkdirSync(subDir, { recursive: true });
      for (const sub of convo.subAgents) {
        writeFileSync(
          path.join(subDir, `agent-${sub.agentId}.jsonl`),
          sub.lines.join("\n") + "\n",
        );
        subAgentCount += 1;
      }
    }
    convoCount += 1;
  }

  console.log(
    `Wrote ${convoCount} conversations (${subAgentCount} sub-agents) across ${PROJECTS.length} projects.`,
  );
  console.log(`Ingesting into ${DEFAULT_DB_PATH} …`);

  const summary = await refresh({ logsRoot, dbPath: DEFAULT_DB_PATH });
  console.log("Refresh summary:", summary);

  // Clean up the throwaway logs — the DB rows persist on their own.
  rmSync(logsRoot, { recursive: true, force: true });
  console.log("Done. Temp logs removed; data is in the DB.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
