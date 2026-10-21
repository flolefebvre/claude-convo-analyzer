// The fake-log generator behind `pnpm seed`: realistic, obviously invented
// Claude Code JSONL transcripts, written under a logs root in the real on-disk
// layout (`<log folder>/<session>.jsonl` + `<session>/subagents/…`), so the
// genuine `refresh()` parses them like any other log.
//
// Re-entrant by construction: every call builds its own generator state (the
// PRNG, the id counter, the timeline anchor), so two calls with the same `now`
// write byte-identical files, in one process or across runs.

import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { sentMessageHash } from "@/core/canonical-json";

/** One call's generator state: a deterministic PRNG (LCG), an id counter, and
 *  the instant the seeded timeline ends at. */
type Gen = {
  readonly now: number;
  rand(): number;
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  uid(prefix: string): string;
};

function createGen(now: number): Gen {
  let seed = 0x2f6e2b1;
  let idCounter = 0;
  const gen: Gen = {
    now,
    rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    },
    int(min, max) {
      return Math.floor(min + gen.rand() * (max - min + 1));
    },
    pick(arr) {
      return arr[gen.int(0, arr.length - 1)];
    },
    chance(p) {
      return gen.rand() < p;
    },
    uid(prefix) {
      idCounter += 1;
      return `${prefix}-${idCounter.toString(36)}`;
    },
  };
  return gen;
}

// ── Generic demo content (safe for a public README) ──────────────────────────

/** A seeded Project: its path, and the GitHub repo its pull requests link to. */
type SeedProject = { path: string; repo: string };

/** The seeded repos, under the real home directory so the folder tree shows `~` as on a real machine. */
const PROJECTS: readonly SeedProject[] = [
  { path: path.join(os.homedir(), "dev", "acme-api"), repo: "acme/acme-api" },
  { path: path.join(os.homedir(), "dev", "web-dashboard"), repo: "acme/web-dashboard" },
  { path: path.join(os.homedir(), "dev", "billing-service"), repo: "acme/billing-service" },
  { path: path.join(os.homedir(), "dev", "mobile-app"), repo: "acme/mobile-app" },
  { path: path.join(os.homedir(), "dev", "data-pipeline"), repo: "acme/data-pipeline" },
  { path: path.join(os.homedir(), "dev", "docs-site"), repo: "acme/docs-site" },
];

/** The Folders the seeded settings file favorites, in that order: three repos, so a favorite can move into the middle. */
export const SEED_FAVORITE_PATHS: readonly string[] = [PROJECTS[0].path, PROJECTS[1].path, PROJECTS[3].path];

/** The git worktree of the first repo that a continuation is resumed in (issue #120). */
export const FAMILY_WORKTREE_PROJECT_PATH = `${PROJECTS[0].path}/.claude/worktrees/billing-spike`;

/** The scratch directory whose per-session subdirectories each hold one Conversation (issue #120). */
export const SCRATCH_PARENT_PATH = "/tmp/scratch";

/** The per-session subdirectories of {@link SCRATCH_PARENT_PATH}, one Project each. */
const SCRATCH_SESSIONS = ["20260612-091204", "20260615-142530", "20260618-170012"] as const;

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

const MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"] as const;

const SKILLS = ["tdd", "orchestrate", "commit", "code-review", "fresh-review"] as const;
const SUBAGENT_TYPES = ["Explore", "Plan", "general-purpose"] as const;

/**
 * The task a sub-agent is spawned with, one per agent type. The SAME string is
 * the parent's `Agent` tool_use `input.prompt` AND the first record of the
 * sub-agent's own transcript — that is how a real log reads. Keyed by the
 * already-picked agent type rather than picked at random, so adding it costs no
 * draw from the PRNG and the rest of the seeded corpus stays byte-identical.
 * Plan's is a multi-paragraph markdown Task prompt, as agents write them.
 */
const SUBAGENT_PROMPTS: Record<(typeof SUBAGENT_TYPES)[number], string> = {
  Explore: "Sweep the repo and report where this behaviour is implemented.",
  Plan: [
    "## Task",
    "",
    "Draft the implementation plan for this change, smallest slices first.",
    "",
    "## Constraints",
    "",
    "- keep the public API unchanged",
    "- one commit per slice",
    "",
    "Start from the entry point:",
    "",
    "```ts",
    'export { handler } from "./server";',
    "```",
  ].join("\n"),
  "general-purpose": "Investigate this and report back with what you find.",
};

/**
 * The hand-back a foreground sub-agent returns, one per agent type — its spawn
 * ledger's `content` text. Keyed like {@link SUBAGENT_PROMPTS}, so no PRNG draw.
 * Plan's is a markdown report, as agents write them.
 */
const SUBAGENT_REPORTS: Record<(typeof SUBAGENT_TYPES)[number], string> = {
  Explore: "The behaviour lives in `src/server.ts`, in `handler`.",
  Plan: [
    "## Plan",
    "",
    "Three slices, each its own commit:",
    "",
    "- extract the ranking into `rank.ts`",
    "- add the new scorer behind a flag",
    "- switch the flag on and delete the old path",
  ].join("\n"),
  "general-purpose": "Found it: the cache key ignores the locale.",
};

/** The `description` an Agent call carries, one per agent type — keyed like {@link SUBAGENT_PROMPTS}, so no PRNG draw. */
const SUBAGENT_DESCRIPTIONS: Record<(typeof SUBAGENT_TYPES)[number], string> = {
  Explore: "locate the behaviour",
  Plan: "plan the change",
  "general-purpose": "investigate",
};
const BASH_CMDS = ["pnpm test", "pnpm lint", "git status", "pnpm build", "npm run typecheck"] as const;
const READ_FILES = ["src/index.ts", "src/server.ts", "README.md", "src/db.ts", "package.json"] as const;

/** The Claude Code version every seeded record (and API request) states. */
const CC_VERSION = "2.1.185";

const DAY = 86_400_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** The fields every main-thread assistant record opens with, ids drawn in log order. */
function assistantEnvelope(g: Gen, ms: number, cwd: string): Record<string, unknown> {
  return {
    type: "assistant",
    uuid: g.uid("a"),
    requestId: g.uid("req"),
    timestamp: iso(ms),
    cwd,
    gitBranch: "main",
    version: CC_VERSION,
  };
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

function makeUsage(g: Gen, scale: number): Usage {
  // Real Claude Code logs always carry integer token counts, so a non-integer
  // `scale` must not leak fractions into the output. Round the component, then
  // derive the sum from it — that keeps `cache_creation_input_tokens` exactly
  // equal to the ephemeral breakdown, which rounding the sum separately would
  // not.
  const create5m = Math.round(g.int(800, 18_000) * scale);
  const create1h = g.chance(0.3) ? g.int(0, 4_000) : 0;
  return {
    input_tokens: g.int(150, 2_200),
    output_tokens: g.int(300, 4_500),
    cache_creation_input_tokens: create5m + create1h,
    cache_read_input_tokens: g.int(4_000, 160_000),
    cache_creation: {
      ephemeral_5m_input_tokens: create5m,
      ephemeral_1h_input_tokens: create1h,
    },
  };
}

/** A sub-agent's transcript: its id, and its JSONL records in file order. */
export type SubAgent = { agentId: string; lines: string[] };

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
  g: Gen,
  ms: number,
  cwd: string,
  model: string,
  agent?: { agentId: string; agentType: string },
): string {
  const failure = g.pick(API_ERRORS);
  const rec: Record<string, unknown> = {
    ...assistantEnvelope(g, ms, cwd),
    isApiErrorMessage: true,
    apiErrorStatus: failure.status,
    message: {
      id: g.uid("msg"),
      role: "assistant",
      model,
      content: [{ type: "text", text: failure.text }],
      usage: {
        input_tokens: g.int(80, 900),
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: g.int(2_000, 40_000),
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
  g: Gen,
  ms: number,
  cwd: string,
  model: string,
  opts: { skill?: string; toolUses?: object[]; scale?: number } = {},
): string {
  const content: object[] = [{ type: "text", text: g.pick(ASSISTANT_REPLIES) }];
  if (opts.toolUses) content.push(...opts.toolUses);
  const rec: Record<string, unknown> = {
    ...assistantEnvelope(g, ms, cwd),
    message: {
      id: g.uid("msg"),
      role: "assistant",
      model,
      content,
      usage: makeUsage(g, opts.scale ?? 1),
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
  g: Gen,
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
    uuid: g.uid("u"),
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
  g: Gen,
  ms: number,
  cwd: string,
  toolUseId: string,
  result: unknown,
  isError = false,
  agent?: { agentId: string },
): string {
  const rec: Record<string, unknown> = {
    type: "user",
    uuid: g.uid("u"),
    timestamp: iso(ms),
    cwd,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: "ok", is_error: isError }],
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
  {
    name: "Read",
    weight: 9,
    errorChance: 0.02,
    min: 400,
    max: 42_000,
    input: (g: Gen) => ({ file_path: g.pick(READ_FILES) }),
  },
  {
    name: "Bash",
    weight: 8,
    errorChance: 0.13,
    min: 40,
    max: 6_000,
    input: (g: Gen) => ({ command: g.pick(BASH_CMDS) }),
  },
  {
    name: "Edit",
    weight: 6,
    errorChance: 0.08,
    min: 30,
    max: 320,
    input: (g: Gen) => ({ file_path: g.pick(READ_FILES) }),
  },
  {
    name: "Grep",
    weight: 5,
    errorChance: 0.04,
    min: 80,
    max: 14_000,
    input: (g: Gen) => ({ pattern: g.pick(GREP_PATTERNS) }),
  },
  { name: "Skill", weight: 3, errorChance: 0.02, min: 600, max: 9_000, input: (g: Gen) => ({ skill: g.pick(SKILLS) }) },
  {
    name: "mcp__github__create_issue",
    weight: 2,
    errorChance: 0.17,
    min: 200,
    max: 1_400,
    input: (g: Gen) => ({ title: g.pick(TITLES), repository: "acme/acme-api" }),
  },
  {
    name: "mcp__linear__search_issues",
    weight: 2,
    errorChance: 0.09,
    min: 300,
    max: 22_000,
    input: (g: Gen) => ({ query: g.pick(MCP_QUERIES) }),
  },
] as const;

const TOTAL_TOOL_WEIGHT = TOOL_KINDS.reduce((sum, k) => sum + k.weight, 0);

/** Pick a tool kind by weight, so built-ins dominate as they do in real logs. */
function pickToolKind(g: Gen): (typeof TOOL_KINDS)[number] {
  let roll = g.rand() * TOTAL_TOOL_WEIGHT;
  for (const kind of TOOL_KINDS) {
    roll -= kind.weight;
    if (roll <= 0) return kind;
  }
  return TOOL_KINDS[0];
}

const RESULT_FILLER = "export function handler(req: Request) { const user = await lookup(req); return json(user); }\n";

const ERROR_MESSAGES = [
  "Error: command failed with exit code 1",
  "Error: ENOENT: no such file or directory",
  "Error: request failed (429 Too Many Requests)",
  "Error: string to replace not found in file",
  "Error: timed out after 120000ms",
] as const;

/** A result payload of roughly the kind's size band (or a short error message). */
function toolResultText(g: Gen, kind: (typeof TOOL_KINDS)[number], isError: boolean): string {
  if (isError) return g.pick(ERROR_MESSAGES);
  const size = g.int(kind.min, kind.max);
  return RESULT_FILLER.repeat(Math.ceil(size / RESULT_FILLER.length)).slice(0, size);
}

/**
 * Build a sub-agent transcript file + the parent's spawn ledger tool_result.
 * `canFail: false` rules out its failed turns, without drawing for them.
 * `stopsOnlyAtItsLastTurn: true` makes every earlier Turn call a tool and the
 * last one only reply, so each later Turn answers a tool result and the
 * sub-agent ends on its reply, as in a real sub-agent's transcript.
 * `agentType` pins its type; the type is still drawn, so the stream stays the same.
 */
function spawnSubAgent(
  g: Gen,
  ms: number,
  cwd: string,
  {
    canFail = true,
    stopsOnlyAtItsLastTurn = false,
    agentType: pinnedAgentType,
  }: {
    canFail?: boolean;
    stopsOnlyAtItsLastTurn?: boolean;
    agentType?: (typeof SUBAGENT_TYPES)[number];
  } = {},
): { toolUse: object; ledgerResult: object; sub: SubAgent } {
  const agentId = g.uid("agent").replace("agent-", "");
  const toolUseId = g.uid("tu");
  const drawnAgentType = g.pick(SUBAGENT_TYPES);
  const agentType = pinnedAgentType ?? drawnAgentType;
  const subModel = g.pick(MODELS);

  // The sub-agent's own transcript — the source of truth for its tokens. Every
  // record in it carries the real sidechain shape (`isSidechain` + `agentId`),
  // and its assistant turns name the spawned agent via `attributionAgent`.
  //
  // It OPENS with the prompt the sub-agent was handed (issue #56), exactly as a
  // real file does, then replies from five seconds later on.
  const prompt = SUBAGENT_PROMPTS[agentType];
  const subLines: string[] = [userPrompt(g, ms, cwd, prompt, undefined, { agentId })];
  let subTotal = 0;
  const turns = g.int(2, 5);
  for (let i = 0; i < turns; i++) {
    const turnMs = ms + 5_000 + i * 30_000;
    const u = makeUsage(g, 0.6);
    const subKind = pickToolKind(g);
    const subToolUse = (stopsOnlyAtItsLastTurn ? i < turns - 1 : g.chance(0.6))
      ? { type: "tool_use", id: g.uid("tu"), name: subKind.name, input: subKind.input(g) }
      : null;
    const subText = g.pick(SUB_AGENT_REPLIES);
    subTotal += u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
    subLines.push(
      JSON.stringify({
        type: "assistant",
        uuid: g.uid("sa"),
        requestId: g.uid("sreq"),
        timestamp: iso(turnMs),
        cwd,
        gitBranch: "main",
        version: CC_VERSION,
        isSidechain: true,
        agentId,
        attributionAgent: agentType,
        resolvedModel: subModel,
        message: {
          id: g.uid("smsg"),
          role: "assistant",
          model: subModel,
          content:
            subToolUse === null ? [{ type: "text", text: subText }] : [{ type: "text", text: subText }, subToolUse],
          usage: u,
        },
      }),
    );
    // A sub-agent's turn can fail exactly like the main thread's.
    if (canFail && g.chance(0.06)) {
      subLines.push(apiErrorTurn(g, turnMs + 15_000, cwd, subModel, { agentId, agentType }));
    }
    // Sub-agents call tools too, and the Tools page counts them — same friction.
    if (subToolUse !== null) {
      const isError = g.chance(subKind.errorChance);
      subLines.push(
        toolResult(g, turnMs + 5_000, cwd, subToolUse.id, toolResultText(g, subKind, isError), isError, { agentId }),
      );
    }
  }

  const toolUse = {
    type: "tool_use",
    id: toolUseId,
    name: "Agent",
    input: { subagent_type: agentType, description: SUBAGENT_DESCRIPTIONS[agentType], prompt },
  };
  const ledgerResult = {
    agentId,
    agentType,
    status: "completed",
    content: [{ type: "text", text: SUBAGENT_REPORTS[agentType] }],
    resolvedModel: subModel,
    totalTokens: subTotal,
    totalToolUseCount: g.int(2, 8),
    totalDurationMs: g.int(8_000, 60_000),
    usage: makeUsage(g, 0.6),
  };
  return { toolUse, ledgerResult, sub: { agentId, lines: subLines } };
}

/** Where a later session can pick this one up (`--resume`/fork): the record it
 *  would continue from, and when that happened. */
type ResumePoint = { uuid: string; ms: number };

/** A seeded Conversation: where it is filed, and its JSONL records, main agent and sub-agents. */
type Conversation = {
  /** The log folder Claude Code files it in (see {@link logFolderNameOf}). */
  logFolderName: string;
  /** The Project it belongs to (GLOSSARY.md, Project). */
  projectPath: string;
  sessionId: string;
  mainLines: string[];
  subAgents: SubAgent[];
  /** The point a continuation of this conversation attaches to. */
  resumePoint: ResumePoint;
};

function buildConversation(
  g: Gen,
  project: SeedProject,
  index: number,
  opts: {
    /** Makes this a CONTINUATION of an earlier session (issue #46): its first
     *  prompt carries that session's record as `parentUuid`, and it starts a few
     *  hours later. */
    resumeFrom?: ResumePoint;
    /** Overrides the random title — used so a family reads as one piece of work.
     *  `null` leaves it untitled: no `ai-title` record, and another session's
     *  message in place of the first prompt — a Conversation without a title
     *  takes its first Prompt as one, so it must have none. */
    title?: string | null;
    /** Starts it this long before the anchor, in ms, rather than at a random offset. */
    startedAgo?: number;
    /** Puts the first turn on this Resolved model; the rest stay on priced ones. */
    unpricedModel?: string;
    /** `"forced"`: the first turn is followed by an API error, whatever the draws.
     *  `"none"`: no turn fails, main thread or sub-agent. Unset: the usual odds. */
    apiErrors?: "forced" | "none";
  } = {},
): Conversation {
  const cwd = project.path;
  const logFolderName = logFolderNameOf(cwd);
  const sessionId = `seed-${logFolderName.slice(1)}-${index}`;

  const start =
    opts.resumeFrom !== undefined
      ? opts.resumeFrom.ms + g.int(1, 8) * 3_600_000
      : opts.startedAgo !== undefined
        ? g.now - opts.startedAgo
        : g.now - g.int(0, 21) * DAY - g.int(0, 18) * 3_600_000;
  let t = start;
  const lines: string[] = [];
  const subAgents: SubAgent[] = [];

  const title = opts.title === undefined ? g.pick(TITLES) : opts.title;
  if (title === null) {
    const body = g.pick(PROMPTS);
    lines.push(
      originRecord(
        g,
        t,
        cwd,
        { kind: "peer", from: "team-lead", name: "team-lead", body },
        `Another Claude session sent a message:\n<agent-message from="team-lead">\n${body}\n</agent-message>`,
        { isMeta: true, permissionMode: "default" },
      ),
    );
  } else {
    lines.push(JSON.stringify({ type: "ai-title", aiTitle: title }));
    lines.push(userPrompt(g, t, cwd, g.pick(PROMPTS), opts.resumeFrom?.uuid));
  }

  // Most conversations have a dominant model; some are mixed.
  const dominant = g.pick(MODELS);
  const mixed = g.chance(0.35);
  const usesSkill = g.chance(0.6);
  const skill = usesSkill ? g.pick(SKILLS) : undefined;

  const turns = g.int(3, 9);
  for (let i = 0; i < turns; i++) {
    t += g.int(20_000, 240_000);
    const drawn = mixed && g.chance(0.4) ? g.pick(MODELS) : dominant;
    const model = i === 0 && opts.unpricedModel !== undefined ? opts.unpricedModel : drawn;
    const toolUses: object[] = [];

    if (g.chance(0.7)) {
      const tuId = g.uid("tu");
      const kind = pickToolKind(g);
      const isError = g.chance(kind.errorChance);
      toolUses.push({ type: "tool_use", id: tuId, name: kind.name, input: kind.input(g) });
      lines.push(assistantTurn(g, t, cwd, model, { skill, toolUses }));
      t += g.int(2_000, 20_000);
      lines.push(toolResult(g, t, cwd, tuId, toolResultText(g, kind, isError), isError));
    } else {
      lines.push(assistantTurn(g, t, cwd, model, { skill }));
    }

    // The API occasionally fails a turn; Claude Code retries on the next one.
    if ((opts.apiErrors === "forced" && i === 0) || (opts.apiErrors !== "none" && g.chance(0.05))) {
      t += g.int(3_000, 15_000);
      lines.push(apiErrorTurn(g, t, cwd, model));
    }

    // Occasionally spawn a sub-agent.
    if (g.chance(0.22)) {
      t += g.int(10_000, 30_000);
      const { toolUse, ledgerResult, sub } = spawnSubAgent(g, t, cwd, { canFail: opts.apiErrors !== "none" });
      lines.push(assistantTurn(g, t, cwd, dominant, { skill, toolUses: [toolUse] }));
      t += g.int(8_000, 40_000);
      lines.push(toolResult(g, t, cwd, (toolUse as { id: string }).id, ledgerResult));
      subAgents.push(sub);
    }
  }

  // A PR link on some conversations.
  if (g.chance(0.4)) {
    lines.push(
      JSON.stringify({
        type: "pr-link",
        prNumber: g.int(10, 480),
        prUrl: `https://github.com/${project.repo}/pull/${g.int(10, 480)}`,
        prRepository: project.repo,
      }),
    );
  }

  // A turn-duration system record on most conversations.
  if (g.chance(0.7)) {
    lines.push(
      JSON.stringify({
        type: "system",
        subtype: "turn_duration",
        durationMs: g.int(45_000, 1_800_000),
        messageCount: turns * 2,
      }),
    );
  }

  return {
    logFolderName,
    projectPath: cwd,
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
 *    it, a continuation of the first one, and one resumed in a git worktree of
 *    it, ANOTHER Project (five members, depth 3, one cross-directory);
 *  - a plain two-sitting chain in the second project.
 *
 * Indices continue after the standalone conversations so their session ids —
 * and therefore the whole seed — stay deterministic run to run.
 */
function continuationFamilies(g: Gen, startIndex: number): Conversation[] {
  const forkProject = PROJECTS[0];
  const chainProject = PROJECTS[1];
  let i = startIndex;

  const root = buildConversation(g, forkProject, i++, {
    title: "Split the billing service out of the monolith",
  });
  const firstBranch = buildConversation(g, forkProject, i++, {
    resumeFrom: root.resumePoint,
    title: "Billing split — extract the invoice writer",
  });
  const secondBranch = buildConversation(g, forkProject, i++, {
    resumeFrom: root.resumePoint,
    title: "Billing split — try the event-sourced angle instead",
  });
  const deeper = buildConversation(g, forkProject, i++, {
    resumeFrom: firstBranch.resumePoint,
    title: "Billing split — migrate the last caller and delete the shim",
  });

  // Resumed from a git worktree of the same repo: Claude Code launches there in
  // its own directory, so the sitting belongs to a DIFFERENT Project (GLOSSARY.md).
  const inWorktree = buildConversation(g, { ...forkProject, path: FAMILY_WORKTREE_PROJECT_PATH }, i++, {
    resumeFrom: secondBranch.resumePoint,
    title: "Billing split — event-sourced spike, in a worktree",
  });

  const chainStart = buildConversation(g, chainProject, i++, {
    title: "Make the nightly export idempotent",
  });
  const chainEnd = buildConversation(g, chainProject, i++, {
    resumeFrom: chainStart.resumePoint,
    title: "Nightly export — finish the retry path",
  });

  return [root, firstBranch, secondBranch, deeper, inWorktree, chainStart, chainEnd];
}

/**
 * The UI states the corpus must show by construction (issue #71): enough
 * standalone Conversations to spill the list onto a second page, one
 * Conversation with unpriced usage, and another with API errors. Each dedicated
 * Conversation shows exactly one of the two states.
 *
 * Drawn after the families, so every earlier Conversation keeps its draws.
 */
function coverageConversations(g: Gen, startIndex: number): Conversation[] {
  const filler = 21;
  const conversations: Conversation[] = [];
  let i = startIndex;
  for (let n = 0; n < filler; n++, i++) {
    conversations.push(buildConversation(g, PROJECTS[i % PROJECTS.length], i));
  }
  conversations.push(
    buildConversation(g, PROJECTS[3], i++, {
      title: "Investigate a model the price table does not know",
      unpricedModel: "<synthetic>",
      apiErrors: "none",
    }),
    buildConversation(g, PROJECTS[4], i++, {
      title: "Finish the release while the API keeps failing",
      apiErrors: "forced",
    }),
  );
  return conversations;
}

/** The seeded Conversation where agents talk to each other (issue #96). */
export const AGENT_MESSAGES_TITLE = "Coordinate the search rewrite across agents";

/** A user record from someone other than the person at the keyboard (`origin` set). */
function originRecord(
  g: Gen,
  ms: number,
  cwd: string,
  origin: Record<string, unknown>,
  content: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: "user",
    uuid: g.uid("u"),
    timestamp: iso(ms),
    cwd,
    gitBranch: "main",
    version: CC_VERSION,
    ...extra,
    origin,
    message: { role: "user", content },
  });
}

/** A `queued_command` attachment: a message delivered while the agent was working. */
function queuedCommand(g: Gen, ms: number, attachment: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "attachment",
    uuid: g.uid("att"),
    timestamp: iso(ms),
    ...extra,
    attachment: { type: "queued_command", source_uuid: g.uid("src"), ...attachment },
  });
}

/** A `<task-notification>` as Claude Code writes it, `result` entity-escaped. */
function taskNotificationXml(taskId: string, status: string, summary: string, result?: string): string {
  const escaped = result?.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    "<task-notification>",
    `<task-id>${taskId}</task-id>`,
    `<output-file>/tmp/claude/tasks/${taskId}.output</output-file>`,
    `<status>${status}</status>`,
    `<summary>${summary}</summary>`,
    ...(escaped === undefined ? [] : [`<result>${escaped}</result>`]),
    "</task-notification>",
  ].join("\n");
}

/**
 * One Conversation carrying every user Message shape of issue #96, so the UI
 * check and the e2e spec can find them: a plugin Prompt, two Sub-agents — one
 * reporting in and handing back, the other stopped — a cross-session peer
 * message and a Prompt sent while working (both `queued_command`), Task
 * notifications in three statuses, and coordinator messages inside a Sub-agent.
 * Recent, so it lands on the list's first page.
 */
function agentMessagesConversation(g: Gen, index: number): Conversation {
  const project = PROJECTS[5];
  const cwd = project.path;
  const logFolderName = logFolderNameOf(cwd);
  const sessionId = `seed-${logFolderName.slice(1)}-${index}`;
  const model = MODELS[0];
  let t = g.now - 3 * 3_600_000;
  const at = (seconds: number) => (t += seconds * 1_000);

  const lines: string[] = [JSON.stringify({ type: "ai-title", aiTitle: AGENT_MESSAGES_TITLE })];
  lines.push(
    originRecord(
      g,
      t,
      cwd,
      { kind: "plugin", name: "session-history", asUser: true },
      "Pick up where we left off on the search rewrite.",
      { permissionMode: "default" },
    ),
  );

  const spawn = (agentType?: (typeof SUBAGENT_TYPES)[number]): { sub: SubAgent; agentType: string } => {
    const { toolUse, ledgerResult, sub } = spawnSubAgent(g, at(60), cwd, { canFail: false, agentType });
    lines.push(assistantTurn(g, t, cwd, model, { toolUses: [toolUse] }));
    lines.push(toolResult(g, at(5), cwd, (toolUse as { id: string }).id, ledgerResult));
    return { sub, agentType: (ledgerResult as { agentType: string }).agentType };
  };
  const { sub: worker, agentType: workerType } = spawn();
  // Plan, for its markdown Task prompt: the e2e opened-Agent-call test relies on it.
  const { sub: stopped } = spawn("Plan");

  // The worker reports in, then hands back; meanwhile the person and another
  // session speak while the main agent is busy.
  const status = "Indexing is done; starting on **ranking** next.";
  lines.push(
    originRecord(
      g,
      at(120),
      cwd,
      { kind: "peer", from: workerType, senderTaskId: worker.agentId, name: workerType, body: status },
      `Another Claude session sent a message:\n<agent-message from="${workerType}">\n${status}\n</agent-message>`,
      { isMeta: true },
    ),
  );
  lines.push(
    queuedCommand(g, at(40), {
      prompt: "Keep the old endpoint working until the mobile client ships.",
      commandMode: "prompt",
      origin: { kind: "human" },
      timestamp: iso(t),
    }),
  );
  const heads = "Docs freeze starts Friday: ping me before renaming any endpoint.";
  const socket = "uds:/run/user/1000/cc-socks/4242.sock";
  lines.push(
    queuedCommand(g, at(30), {
      prompt: `<cross-session-message from="${socket}" from-name="docs-site release">\n${heads}\n</cross-session-message>`,
      commandMode: "prompt",
      isMeta: true,
      origin: { kind: "peer", from: socket, msg_id: g.uid("msg"), name: "docs-site release", body: heads },
      timestamp: iso(t),
    }),
  );
  const report = "## Report\n\nRanking is rewritten on BM25 and the old endpoint still answers.\n\n- 42 tests pass";
  const frame = "[Subagent hand-back] The text below is the final report of a subagent. The report follows:";
  lines.push(
    originRecord(
      g,
      at(180),
      cwd,
      {
        kind: "peer",
        from: worker.agentId,
        senderTaskId: worker.agentId,
        name: workerType,
        body: `${frame}\n  ${report.replace(/\n/g, "\n  ")}`,
        handback: true,
        handbackReportText: report,
      },
      `Another Claude session sent a message:\n<agent-message from="${worker.agentId}">\n${frame}\n</agent-message>`,
      { isMeta: true },
    ),
  );
  lines.push(
    originRecord(
      g,
      at(2),
      cwd,
      { kind: "task-notification" },
      taskNotificationXml(worker.agentId, "completed", 'Agent "rewrite ranking" finished', report),
    ),
  );
  lines.push(
    originRecord(
      g,
      at(30),
      cwd,
      { kind: "task-notification", producer: "session-task" },
      taskNotificationXml(g.uid("b"), "failed", 'Background command "pnpm build" failed with exit code 1'),
    ),
  );
  lines.push(
    originRecord(
      g,
      at(30),
      cwd,
      { kind: "task-notification" },
      taskNotificationXml(stopped.agentId, "stopped", 'Agent "profile the indexer" was stopped'),
    ),
  );
  lines.push(assistantTurn(g, at(20), cwd, model));

  // Inside the worker: the main agent steers it, once between turns and once
  // mid-turn (a `queued_command`).
  const workerStart = Date.parse((JSON.parse(worker.lines[0]) as { timestamp: string }).timestamp);
  const sidechain = { isSidechain: true, agentId: worker.agentId };
  worker.lines.push(
    originRecord(
      g,
      workerStart + 20_000,
      cwd,
      { kind: "coordinator" },
      "The coordinator sent a message while you were working:\nGood plan. Keep the old endpoint answering.",
      { ...sidechain, isMeta: true },
    ),
    queuedCommand(
      g,
      workerStart + 40_000,
      { prompt: "Also cover the empty-query case.", origin: { kind: "coordinator" }, isMeta: true },
      sidechain,
    ),
  );

  return {
    logFolderName,
    projectPath: cwd,
    sessionId,
    mainLines: lines,
    subAgents: [worker, stopped],
    resumePoint: { uuid: lastAssistantUuid(lines), ms: t },
  };
}

/** The seeded Conversation whose main agent spans three Transcript pages (issue #82). */
export const LONG_TITLE = "Port every report to the new rendering engine";

/** A prompt only the long Conversation holds, on its main agent's SECOND Transcript page. */
export const LONG_PAGE_TWO_TEXT = "Now port the quarterly heatmap export the same way.";

/** Follow-up prompts between the long Conversation's turns. */
const LONG_FOLLOW_UPS = [
  "Next report, same pattern.",
  "Looks right — keep going.",
  "Carry on with the next one.",
  "Good. Move to the following report.",
] as const;

/**
 * A Conversation whose main agent renders 450 messages — an opening prompt,
 * then 225 rounds of an assistant turn and a follow-up prompt, minus the last
 * prompt — so at 200 messages a page it spans three Transcript pages and both
 * "next" and "last" mean something. Its 150th follow-up, message 301, is
 * {@link LONG_PAGE_TWO_TEXT}.
 */
function longConversation(g: Gen, index: number): Conversation {
  const project = PROJECTS[4];
  const cwd = project.path;
  const logFolderName = logFolderNameOf(cwd);
  const sessionId = `seed-${logFolderName.slice(1)}-${index}`;
  const model = g.pick(MODELS);
  const rounds = 225;
  let t = g.now - 9 * DAY;
  const lines = [JSON.stringify({ type: "ai-title", aiTitle: LONG_TITLE }), userPrompt(g, t, cwd, g.pick(PROMPTS))];
  for (let round = 1; round <= rounds; round++) {
    t += g.int(20_000, 90_000);
    if (g.chance(0.5)) {
      const tuId = g.uid("tu");
      const kind = pickToolKind(g);
      const isError = g.chance(kind.errorChance);
      lines.push(
        assistantTurn(g, t, cwd, model, {
          toolUses: [{ type: "tool_use", id: tuId, name: kind.name, input: kind.input(g) }],
          scale: 0.2,
        }),
      );
      t += g.int(2_000, 10_000);
      lines.push(toolResult(g, t, cwd, tuId, toolResultText(g, kind, isError), isError));
    } else {
      lines.push(assistantTurn(g, t, cwd, model, { scale: 0.2 }));
    }
    if (round === rounds) break;
    t += g.int(10_000, 60_000);
    lines.push(userPrompt(g, t, cwd, round === 150 ? LONG_PAGE_TWO_TEXT : g.pick(LONG_FOLLOW_UPS)));
  }
  return {
    logFolderName,
    projectPath: cwd,
    sessionId,
    mainLines: lines,
    subAgents: [],
    resumePoint: { uuid: lastAssistantUuid(lines), ms: t },
  };
}

/** The name of the log folder Claude Code files a session run in `dir` under:
 *  the path with every `/` and `.` replaced by `-`. */
function logFolderNameOf(dir: string): string {
  return dir.replace(/[/.]/g, "-");
}

/** `line` with its record's `cwd` replaced by `cwd`, or removed when `cwd` is null;
 *  a record without one (a title, a PR link) is left as is. */
function withCwd(line: string, cwd: string | null): string {
  const record = JSON.parse(line) as Record<string, unknown>;
  if (!("cwd" in record)) return line;
  if (cwd === null) delete record.cwd;
  else record.cwd = cwd;
  return JSON.stringify(record);
}

/** The seeded Conversation that enters a git worktree after its first prompt (issue #119). */
export const WORKTREE_SWITCH_TITLE = "Fix the flaky auth test in a worktree";

/** The worktree {@link WORKTREE_SWITCH_TITLE} moves into, and therefore its Project. */
export const WORKTREE_SWITCH_PROJECT_PATH = `${PROJECTS[0].path}/.claude/worktrees/fix-auth-flake`;

/** The seeded Conversation whose records state no `cwd` (issue #119). */
export const CWD_LESS_TITLE = "Recover a session whose records state no cwd";

/**
 * The two Conversations whose Project is not their first `cwd` (issue #119),
 * both started in the first Project:
 *
 *  - one that enters a worktree of it after its first prompt, filed — as
 *    Claude Code files it — under the worktree's log folder, so it belongs to
 *    the worktree;
 *  - one whose records state no `cwd`, filed under the first Project's log
 *    folder, so it borrows that Project from its siblings (the folder name
 *    alone would decode to a path that does not exist).
 *
 * Drawn last, so every earlier Conversation keeps its draws.
 */
function projectPathConversations(g: Gen, startIndex: number): Conversation[] {
  const repo = PROJECTS[0];
  const worktree = WORKTREE_SWITCH_PROJECT_PATH;
  const switching = buildConversation(g, repo, startIndex, { title: WORKTREE_SWITCH_TITLE });
  // Lines 0 and 1 are the title and the first prompt, run in the repo.
  const intoWorktree = (lines: string[], from: number) =>
    lines.map((line, i) => (i < from ? line : withCwd(line, worktree)));
  const cwdLess = buildConversation(g, repo, startIndex + 1, { title: CWD_LESS_TITLE });
  const withoutCwd = (lines: string[]) => lines.map((line) => withCwd(line, null));
  return [
    {
      ...switching,
      logFolderName: logFolderNameOf(worktree),
      projectPath: worktree,
      mainLines: intoWorktree(switching.mainLines, 2),
      subAgents: switching.subAgents.map((sub) => ({ ...sub, lines: intoWorktree(sub.lines, 0) })),
    },
    {
      ...cwdLess,
      mainLines: withoutCwd(cwdLess.mainLines),
      subAgents: cwdLess.subAgents.map((sub) => ({ ...sub, lines: withoutCwd(sub.lines) })),
    },
  ];
}

/**
 * A Conversation of two prompts: its main agent's Turns — a `Read`, an
 * `Agent` spawn, a reply, then after the second prompt a `Bash` and a reply —
 * each answer a prompt or a tool result, and so does every Turn of its one
 * sub-agent. No Turn fails. `startedAgo` is how long before the anchor it
 * starts.
 */
function twoPromptConversation(
  g: Gen,
  project: SeedProject,
  opts: { sessionId: string; title: string; startedAgo: number },
): Conversation {
  const cwd = project.path;
  const model = MODELS[0];
  let t = g.now - opts.startedAgo;
  const lines = [JSON.stringify({ type: "ai-title", aiTitle: opts.title }), userPrompt(g, t, cwd, g.pick(PROMPTS))];
  const toolTurn = (kind: (typeof TOOL_KINDS)[number]) => {
    t += g.int(20_000, 120_000);
    const toolUseId = g.uid("tu");
    lines.push(
      assistantTurn(g, t, cwd, model, {
        toolUses: [{ type: "tool_use", id: toolUseId, name: kind.name, input: kind.input(g) }],
      }),
    );
    t += g.int(2_000, 20_000);
    lines.push(toolResult(g, t, cwd, toolUseId, toolResultText(g, kind, false)));
  };

  toolTurn(TOOL_KINDS[0]);
  t += g.int(10_000, 30_000);
  const { toolUse, ledgerResult, sub } = spawnSubAgent(g, t, cwd, { canFail: false, stopsOnlyAtItsLastTurn: true });
  lines.push(assistantTurn(g, t, cwd, model, { toolUses: [toolUse] }));
  t += 180_000; // after the sub-agent's last record (five Turns at most, 30s apart)
  lines.push(toolResult(g, t, cwd, (toolUse as { id: string }).id, ledgerResult));
  lines.push(assistantTurn(g, (t += g.int(20_000, 60_000)), cwd, model));
  lines.push(userPrompt(g, (t += g.int(60_000, 300_000)), cwd, g.pick(PROMPTS)));
  toolTurn(TOOL_KINDS[1]);
  lines.push(assistantTurn(g, (t += g.int(20_000, 60_000)), cwd, model));

  return {
    logFolderName: logFolderNameOf(cwd),
    projectPath: cwd,
    sessionId: opts.sessionId,
    mainLines: lines,
    subAgents: [sub],
    resumePoint: { uuid: lastAssistantUuid(lines), ms: t },
  };
}

/**
 * Two {@link twoPromptConversation}s under fixed session ids. Both end hours
 * before the agent-messages one, so the anchor does not move.
 *
 * Drawn last, so every earlier Conversation keeps its draws.
 */
function twoPromptConversations(g: Gen): Conversation[] {
  return [
    twoPromptConversation(g, PROJECTS[2], {
      sessionId: "5eed0000-0000-4000-8000-000000000001",
      title: "Add an audit trail to the billing exports",
      startedAgo: 8 * 3_600_000,
    }),
    twoPromptConversation(g, PROJECTS[1], {
      sessionId: "5eed0000-0000-4000-8000-000000000002",
      title: "Tighten the webhook signature checks",
      startedAgo: 30 * 3_600_000,
    }),
  ];
}

/** The seeded Conversation whose main agent leaves plan mode, then messages a peer (issue #149). */
export const PLAN_HANDOFF_TITLE = "Hand the search plan to the docs team";

/** The plan its ExitPlanMode call proposes, as a model writes one. */
const HANDOFF_PLAN =
  "# Search API handoff\n\n## Context\n\nThe ranking rewrite ships behind a flag.\n\n## Steps\n\n" +
  "- document the new `rank` parameter\n- keep the old endpoint answering";

/** The message its SendMessage call sends. */
const HANDOFF_MESSAGE =
  "## Search API is ready\n\nThe new `rank` parameter is live behind a flag.\n\n" +
  "- the old endpoint keeps answering\n- docs freeze still Friday";

/**
 * A Conversation whose main agent calls ExitPlanMode, approved, then
 * SendMessage to another session, its delivery receipt stored as the JSON
 * object Claude Code writes.
 *
 * Drawn last, so every earlier Conversation keeps its draws.
 */
function planHandoffConversation(g: Gen, index: number): Conversation {
  const cwd = PROJECTS[5].path;
  const logFolderName = logFolderNameOf(cwd);
  const model = MODELS[0];
  let t = g.now - 5 * 3_600_000;
  const lines = [
    JSON.stringify({ type: "ai-title", aiTitle: PLAN_HANDOFF_TITLE }),
    userPrompt(g, t, cwd, "Plan the search API handoff, then tell the docs session."),
  ];
  const call = (name: string, input: object, result: object) => {
    const toolUseId = g.uid("tu");
    lines.push(
      assistantTurn(g, (t += 30_000), cwd, model, { toolUses: [{ type: "tool_use", id: toolUseId, name, input }] }),
    );
    lines.push(toolResult(g, (t += 5_000), cwd, toolUseId, result));
  };
  call("ExitPlanMode", { plan: HANDOFF_PLAN }, { plan: HANDOFF_PLAN, isAgent: false });
  const to = "docs-site release";
  const summary = "Search API is ready";
  call(
    "SendMessage",
    { to, summary, message: HANDOFF_MESSAGE },
    { success: true, message: `“${summary}” → ${to}`, msg_id: g.uid("msg") },
  );
  lines.push(assistantTurn(g, (t += 20_000), cwd, model));

  return {
    logFolderName,
    projectPath: cwd,
    sessionId: `seed-${logFolderName.slice(1)}-${index}`,
    mainLines: lines,
    subAgents: [],
    resumePoint: { uuid: lastAssistantUuid(lines), ms: t },
  };
}

/** The session id of the seeded Conversation with no title, which the list shows in its place (issue #202). */
export const UNTITLED_SESSION_ID = "5eed0000-0000-4000-8000-000000000003";

/**
 * A Conversation that has no title, opened by another session's message. It
 * starts two days back, so it is on the list's first page, and ends long
 * before the agent-messages one, so the anchor does not move.
 *
 * Drawn last, so every earlier Conversation keeps its draws.
 */
function untitledConversation(g: Gen, index: number): Conversation {
  const convo = buildConversation(g, PROJECTS[2], index, { title: null, startedAgo: 2 * DAY });
  return { ...convo, sessionId: UNTITLED_SESSION_ID };
}

/** The seeded Conversation whose log records each API request, as Claude Code 2.1.300+ does (issue #216). */
export const LOGGED_REQUESTS_TITLE = "Trace the slow invoice query";

/** The Claude Code version {@link LOGGED_REQUESTS_TITLE} states: one that logs its API requests. */
const LOGGED_REQUESTS_CC_VERSION = "2.1.305";

/** A system block of the seeded API requests: the opening line. */
const SEED_SYSTEM_INTRO = {
  type: "text",
  text: "You are Claude Code, a coding agent working in the user's repository.",
};

/** The seeded API requests' environment block, on `date`, with `extraLines` after its last line. */
function seedSystemEnvironment(cwd: string, date: string, extraLines: string[] = []) {
  return {
    type: "text",
    text: [`Working directory: ${cwd}`, `Today's date: ${date}`, "Keep answers short.", ...extraLines].join("\n"),
  };
}

/** A tool definition of the seeded API requests: a stub description and a one-field input schema. */
function seedToolDefinition(name: string, description: string, field: string) {
  return {
    name,
    description,
    input_schema: { type: "object", properties: { [field]: { type: "string" } }, required: [field] },
  };
}

/** One message a seeded API request sends: as the model got it, and whether its log holds it as a blob. */
type SeedSentMessage = { message: { role: string; content: unknown }; isLoggedAsBlob?: true };

/** The message a `user` or `assistant` record `line` holds, as its request sends it: rebuilt from the log. */
function sentMessageOf(line: string): SeedSentMessage {
  const { message } = JSON.parse(line) as { message: { role: string; content: unknown } };
  return { message: { role: message.role, content: message.content } };
}

/** Context Claude Code injects as a system message, unwrapped (log-format §9), which the log holds as a blob. */
function seedSystemMessage(text: string): SeedSentMessage {
  return { message: { role: "system", content: text }, isLoggedAsBlob: true };
}

/**
 * The prompt of user record `promptLine` as sent: after a system-reminder
 * Claude Code injected into the same user message (CLAUDE.md goes out this
 * way), which the log holds as a blob.
 */
function seedPromptWithSystemReminder(promptLine: string, reminderText: string): SeedSentMessage {
  const prompt = sentMessageOf(promptLine).message.content as string;
  return {
    message: {
      role: "user",
      content: [
        { type: "text", text: `<system-reminder>\n${reminderText}\n</system-reminder>` },
        { type: "text", text: prompt },
      ],
    },
    isLoggedAsBlob: true,
  };
}

/** A tool result as the model got it, in full — its record keeps only a stub — which the log holds as a blob. */
function seedToolResultSent(toolUseId: string, result: string): SeedSentMessage {
  return {
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: result }] },
    isLoggedAsBlob: true,
  };
}

/**
 * The writer of one seeded log file's request records (log-format §9): a shape is
 * logged before the first request that sends it, each blob message before the
 * request, and each request starts from the previous one, keeping all its
 * messages. A request that failed is resent as its retry does: the same
 * digest, from it, keeping all its messages and adding none.
 */
function requestRecordWriter(g: Gen, sessionId: string, model: string, querySource: string, agentId?: string) {
  const loggedShapeHashes = new Set<string>();
  let previous: { recordId: string; messageCount: number } | null = null;
  const inFile = (record: Record<string, unknown>) =>
    JSON.stringify(agentId === undefined ? record : { ...record, agentId });
  return {
    /**
     * The lines that log one request sent at `ms` with `shape`, its tail
     * `tail`; with `failedAttemptsLostMs`, it failed that many times first,
     * each attempt resent after the time it lost. `recordId` is the request
     * that went through.
     */
    send(
      ms: number,
      shape: { shapeHash: string; system: object[]; tools: object[] },
      tail: SeedSentMessage[],
      failedAttemptsLostMs: number[] = [],
    ) {
      const lines: string[] = [];
      if (!loggedShapeHashes.has(shape.shapeHash)) {
        loggedShapeHashes.add(shape.shapeHash);
        lines.push(
          inFile({
            type: "api-request-shape",
            sessionId,
            shapeHash: shape.shapeHash,
            shape: { system: shape.system, tools: shape.tools },
          }),
        );
      }
      for (const { message, isLoggedAsBlob } of tail) {
        if (isLoggedAsBlob)
          lines.push(inFile({ type: "api-request-blob", sessionId, hash: sentMessageHash(message), message }));
      }
      const requestDigest = g.uid("digest");
      /** Log one sending at `sentMs` of the request, its tail `tailHashes`. */
      const logRequest = (sentMs: number, tailHashes: string[]) => {
        const recordId = g.uid("apireq");
        const keptMessageCount = previous?.messageCount ?? 0;
        const messageCount = keptMessageCount + tailHashes.length;
        lines.push(
          inFile({
            type: "api-request",
            sessionId,
            id: recordId,
            ...(previous === null ? {} : { base: previous.recordId }),
            keep: keptMessageCount,
            tail: tailHashes,
            shapeHash: shape.shapeHash,
            params: {
              model,
              betas: ["interleaved-thinking-2025-05-14", "context-management-2025-06-27"],
              max_tokens: 32000,
              thinking: { type: "adaptive", display: "updates" },
              context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
              output_config: { effort: "high" },
            },
            cacheControl: [
              { path: ["system", 0], value: { type: "ephemeral", ttl: "1h", scope: "global" } },
              { path: ["system", 1], value: { type: "ephemeral" } },
              { path: ["messages", messageCount - 1, "content", 0], value: { type: "ephemeral" } },
            ],
            querySource,
            requestDigest,
            timestamp: iso(sentMs),
          }),
        );
        previous = { recordId, messageCount };
        return recordId;
      };
      let recordId = logRequest(
        ms,
        tail.map(({ message }) => sentMessageHash(message)),
      );
      let sentMs = ms;
      for (const lostMs of failedAttemptsLostMs) recordId = logRequest((sentMs += lostMs), []);
      return { lines, recordId };
    },
  };
}

/** `line`, an assistant or user record, at {@link LOGGED_REQUESTS_CC_VERSION}, with `requestRef` when given. */
function atLoggedRequestsVersion(line: string, requestRef?: string): string {
  const record = JSON.parse(line) as Record<string, unknown>;
  record.version = LOGGED_REQUESTS_CC_VERSION;
  if (requestRef !== undefined) record.requestRef = requestRef;
  return JSON.stringify(record);
}

/**
 * A Conversation whose log records every API request it sent, its
 * Sub-agent's included (Claude Code 2.1.300+): after a first exchange that
 * spawns an Explore sub-agent — whose report's Turn went through on a retry,
 * after one Failed attempt — a second prompt finds the system prompt
 * changed — a new date and a new instruction — and a Grep tool loaded. It
 * ends hours before the agent-messages one, so the anchor does not move.
 *
 * Drawn last, so every earlier Conversation keeps its draws.
 */
function loggedRequestsConversation(g: Gen, index: number): Conversation {
  const cwd = PROJECTS[4].path;
  const logFolderName = logFolderNameOf(cwd);
  const sessionId = `seed-${logFolderName.slice(1)}-${index}`;
  const model = MODELS[0];
  let t = g.now - 30 * 3_600_000;
  const bash = seedToolDefinition("Bash", "Run a shell command.", "command");
  const read = seedToolDefinition("Read", "Read a file.", "file_path");
  const firstShape = {
    shapeHash: g.uid("shape"),
    system: [SEED_SYSTEM_INTRO, seedSystemEnvironment(cwd, iso(t).slice(0, 10))],
    tools: [bash, read],
  };
  // Picked up a day later: a new date, a new instruction, and Grep loaded.
  const resumedAt = t + DAY;
  const secondShape = {
    shapeHash: g.uid("shape"),
    system: [
      SEED_SYSTEM_INTRO,
      seedSystemEnvironment(cwd, iso(resumedAt).slice(0, 10), ["Run the query planner before changing an index."]),
    ],
    tools: [bash, read, seedToolDefinition("Grep", "Search file contents.", "pattern")],
  };
  const requests = requestRecordWriter(g, sessionId, model, "repl_main_thread");
  const firstPrompt = atLoggedRequestsVersion(
    userPrompt(g, t, cwd, "The invoice list takes eight seconds to load — find out why."),
  );
  const lines = [JSON.stringify({ type: "ai-title", aiTitle: LOGGED_REQUESTS_TITLE }), firstPrompt];
  let lastTurnLine = "";
  /**
   * Log a request sent with `shape` and the messages of `tail`, after the
   * failed attempts that lost `failedAttemptsLostMs`, then the Turn answering it.
   */
  const turn = (
    shape: typeof firstShape,
    tail: SeedSentMessage[],
    toolUses?: object[],
    failedAttemptsLostMs?: number[],
  ) => {
    const sent = requests.send((t += 1_000), shape, tail, failedAttemptsLostMs);
    lines.push(...sent.lines);
    lastTurnLine = atLoggedRequestsVersion(assistantTurn(g, (t += 9_000), cwd, model, { toolUses }), sent.recordId);
    lines.push(lastTurnLine);
  };

  const { toolUse, ledgerResult, sub } = loggedRequestsSubAgent(g, t + 12_000, cwd, sessionId);
  turn(
    firstShape,
    [
      seedPromptWithSystemReminder(
        firstPrompt,
        "As you answer the user's questions, you can use the following context:\n# claudeMd\nRun `pnpm test` before every commit; keep queries in src/invoices/.",
      ),
    ],
    [toolUse],
  );
  t += 120_000; // after the sub-agent's last record
  const agentUseId = (toolUse as { id: string }).id;
  lines.push(atLoggedRequestsVersion(toolResult(g, t, cwd, agentUseId, ledgerResult)));
  // The API was overloaded: the request went through on its retry, 300 ms later.
  turn(
    firstShape,
    [sentMessageOf(lastTurnLine), seedToolResultSent(agentUseId, SUBAGENT_REPORTS.Explore)],
    undefined,
    [300],
  );
  const secondPrompt = atLoggedRequestsVersion(
    userPrompt(g, (t = resumedAt), cwd, "Now check the date filter on the same query."),
  );
  lines.push(secondPrompt);
  const grepUseId = g.uid("tu");
  turn(
    secondShape,
    [
      sentMessageOf(lastTurnLine),
      seedSystemMessage(`The date has changed. Today's date is now ${iso(resumedAt).slice(0, 10)}.`),
      sentMessageOf(secondPrompt),
    ],
    [{ type: "tool_use", id: grepUseId, name: "Grep", input: { pattern: "invoice_date" } }],
  );
  lines.push(atLoggedRequestsVersion(toolResult(g, (t += 4_000), cwd, grepUseId, "src/invoices/query.ts:42")));
  turn(secondShape, [
    sentMessageOf(lastTurnLine),
    seedToolResultSent(grepUseId, "src/invoices/query.ts:42:  WHERE invoice_date >= $1"),
  ]);

  return {
    logFolderName,
    projectPath: cwd,
    sessionId,
    mainLines: lines,
    subAgents: [sub],
    resumePoint: { uuid: lastAssistantUuid(lines), ms: t },
  };
}

/** The Explore sub-agent {@link loggedRequestsConversation} spawns at `ms`, its log holding its two API requests. */
function loggedRequestsSubAgent(
  g: Gen,
  ms: number,
  cwd: string,
  sessionId: string,
): { toolUse: object; ledgerResult: object; sub: SubAgent } {
  const agentId = g.uid("agent").replace("agent-", "");
  const agent = { agentId };
  const prompt = SUBAGENT_PROMPTS.Explore;
  const shape = {
    shapeHash: g.uid("shape"),
    system: [
      { type: "text", text: "You are a search agent: find the code the task names, then report where it lives." },
      seedSystemEnvironment(cwd, iso(ms).slice(0, 10)),
    ],
    tools: [seedToolDefinition("Read", "Read a file.", "file_path")],
  };
  const requests = requestRecordWriter(g, sessionId, MODELS[3], "agent:builtin:Explore", agentId);
  /** The lines of a request sent at `turnMs` with the messages of `tail`, then the Turn answering it. */
  const subTurn = (turnMs: number, tail: SeedSentMessage[], toolUses?: object[]) => {
    const sent = requests.send(turnMs, shape, tail);
    const reply = JSON.parse(assistantTurn(g, turnMs + 5_000, cwd, MODELS[3], { toolUses, scale: 0.6 })) as Record<
      string,
      unknown
    >;
    return [
      ...sent.lines,
      atLoggedRequestsVersion(
        JSON.stringify({ ...reply, isSidechain: true, agentId, attributionAgent: "Explore" }),
        sent.recordId,
      ),
    ];
  };
  const readUseId = g.uid("tu");
  const subPrompt = atLoggedRequestsVersion(userPrompt(g, ms, cwd, prompt, undefined, agent));
  const firstTurnLines = subTurn(
    ms + 2_000,
    [sentMessageOf(subPrompt)],
    [{ type: "tool_use", id: readUseId, name: "Read", input: { file_path: "src/invoices/query.ts" } }],
  );
  const readResult = atLoggedRequestsVersion(toolResult(g, ms + 30_000, cwd, readUseId, RESULT_FILLER, false, agent));
  const lines = [
    subPrompt,
    ...firstTurnLines,
    readResult,
    // Rebuilt from the sub-agent's own records: its Turn, then the tool result.
    ...subTurn(ms + 32_000, [sentMessageOf(firstTurnLines.at(-1)!), sentMessageOf(readResult)]),
  ];
  const toolUseId = g.uid("tu");
  return {
    toolUse: {
      type: "tool_use",
      id: toolUseId,
      name: "Agent",
      input: { subagent_type: "Explore", description: SUBAGENT_DESCRIPTIONS.Explore, prompt },
    },
    ledgerResult: {
      agentId,
      agentType: "Explore",
      status: "completed",
      content: [{ type: "text", text: SUBAGENT_REPORTS.Explore }],
      resolvedModel: MODELS[3],
      totalToolUseCount: 1,
      totalDurationMs: 40_000,
    },
    sub: { agentId, lines },
  };
}

/** Every seeded Conversation, its conversations starting up to three weeks before `anchor`. */
function buildCorpus(anchor: number): Conversation[] {
  const g = createGen(anchor);
  const total = 30;
  const conversations: Conversation[] = [];
  for (let i = 0; i < total; i++) {
    conversations.push(buildConversation(g, PROJECTS[i % PROJECTS.length], i));
  }
  const families = continuationFamilies(g, total);
  conversations.push(...families);
  const coverage = coverageConversations(g, total + families.length);
  conversations.push(...coverage);
  conversations.push(agentMessagesConversation(g, total + families.length + coverage.length));
  conversations.push(longConversation(g, conversations.length));
  conversations.push(...projectPathConversations(g, conversations.length));
  conversations.push(...scratchConversations(g, conversations.length));
  conversations.push(...twoPromptConversations(g));
  conversations.push(planHandoffConversation(g, conversations.length));
  conversations.push(untitledConversation(g, conversations.length));
  conversations.push(loggedRequestsConversation(g, conversations.length));
  return conversations;
}

/**
 * One Conversation per subdirectory of {@link SCRATCH_PARENT_PATH} — the way a
 * session-per-directory tool leaves them — so the folder tree shows a `/tmp`
 * root whose parent Folder holds many single-session sub-Folders (issue #120).
 *
 * Drawn last, so every earlier Conversation keeps its draws.
 */
function scratchConversations(g: Gen, startIndex: number): Conversation[] {
  return SCRATCH_SESSIONS.map((session, n) =>
    buildConversation(g, { path: `${SCRATCH_PARENT_PATH}/${session}`, repo: "acme/scratch" }, startIndex + n),
  );
}

/** The newest record timestamp, main threads and sub-agents alike, in epoch ms. */
function latestTimestamp(conversations: readonly Conversation[]): number {
  return latestLineTimestamp(conversations.flatMap((c) => [...c.mainLines, ...c.subAgents.flatMap((s) => s.lines)]));
}

/** The newest timestamp among `lines`' records, in epoch ms. */
function latestLineTimestamp(lines: readonly string[]): number {
  return Math.max(
    ...lines.map((line) => {
      const { timestamp } = JSON.parse(line) as { timestamp?: string };
      return timestamp === undefined ? -Infinity : Date.parse(timestamp);
    }),
  );
}

/**
 * Write `lines` as the log at `filePath`, dated at its newest record, as
 * Claude Code would have left it: a file dated at the seed would read as just
 * changed (GLOSSARY.md, Active now).
 */
function writeLog(filePath: string, lines: readonly string[]): void {
  writeFileSync(filePath, lines.join("\n") + "\n");
  const writtenAt = new Date(latestLineTimestamp(lines));
  utimesSync(filePath, writtenAt, writtenAt);
}

/** What {@link generateFakeLogs} wrote. */
export type FakeLogsCounts = {
  /** Main session files (Conversations), continuations included. */
  conversations: number;
  /** Sub-agent transcripts, across every Conversation. */
  subAgents: number;
  /** Distinct Projects (by path) the Conversations belong to. */
  projects: number;
};

/**
 * Write the fake logs under `logsRoot`, their timeline ending at `now`: 30
 * standalone Conversations across six Projects, two continuation families
 * (seven more), 23 covering pagination, unpriced usage and API errors, one
 * where agents message each other, one long enough to span three Transcript
 * pages, one that enters a worktree and one that states no cwd, three in
 * per-session scratch directories under `/tmp`, two of two prompts each,
 * one that hands a plan to another session, one with no title, then one
 * whose log records its API requests — 72 in all. The same `now` always writes the same bytes. Returns the counts.
 *
 * @example
 * const counts = generateFakeLogs({ logsRoot: "data/seed/projects", now: new Date() });
 */
export function generateFakeLogs(opts: { logsRoot: string; now: Date }): FakeLogsCounts {
  // Conversations START at random offsets before the anchor, so the newest
  // record falls short of it. The draws never depend on the anchor, so a
  // draft measures that gap and the real pass moves the anchor forward by it.
  const now = opts.now.getTime();
  const conversations = buildCorpus(now + (now - latestTimestamp(buildCorpus(now))));

  let subAgents = 0;
  for (const convo of conversations) {
    const projectDir = path.join(opts.logsRoot, convo.logFolderName);
    mkdirSync(projectDir, { recursive: true });
    writeLog(path.join(projectDir, `${convo.sessionId}.jsonl`), convo.mainLines);

    if (convo.subAgents.length > 0) {
      const subDir = path.join(projectDir, convo.sessionId, "subagents");
      mkdirSync(subDir, { recursive: true });
      for (const sub of convo.subAgents) {
        writeLog(path.join(subDir, `agent-${sub.agentId}.jsonl`), sub.lines);
        subAgents += 1;
      }
    }
  }

  return {
    conversations: conversations.length,
    subAgents,
    projects: new Set(conversations.map((c) => c.projectPath)).size,
  };
}
