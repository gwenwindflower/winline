#!/usr/bin/env bun
/**
 * Claude Code statusline - Bun port of the Deno implementation
 * Catppuccin Frappe themed powerline statusline
 * Configured via ~/.claude/statusline.toml
 */

import { parse as parseToml } from "smol-toml";
import { join } from "node:path";
import { createHash } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionContext {
  hook_event_name: string;
  session_id: string;
  transcript_path: string;
  cwd: string;
  model: {
    id: string;
    display_name: string;
  };
  workspace: {
    current_dir: string;
    project_dir: string;
  };
  version: string;
  output_style: {
    name: string;
  };
  cost?: {
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_duration_ms: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
  context_window?: {
    total_input_tokens: number;
    total_output_tokens: number;
    context_window_size: number;
    current_usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
  };
}

interface LanguageInfo {
  icon: string;
  version?: string;
}

interface ThresholdConfig {
  color: string;
  warn_color?: string;
  warn_threshold?: number;
  critical_color?: string;
  critical_threshold?: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────

interface SegmentConfig {
  color: string;
}

interface GitSegmentConfig extends SegmentConfig {
  colorized_status?: boolean;
}

interface ContextSegmentConfig extends SegmentConfig, ThresholdConfig {
  bar_width: number;
  bar_filled: string;
  bar_empty: string;
}

interface LanguagesSegmentConfig extends SegmentConfig {
  modules: string[];
}

// Separator style for between-segment glyphs
type SeparatorStyle = "powerline" | "slant" | "round" | "straight" | "none";

// Row rendering style:
//   "background" — each segment gets a colored background (classic powerline)
//   "foreground" — segment color is used as fg text color on a shared base bg
type RowStyle = "background" | "foreground";

interface RowConfig {
  segments: string[];
  style: RowStyle;
  separator: SeparatorStyle;
  first_separator: SeparatorStyle;
  last_separator: SeparatorStyle;
}

interface StatuslineConfig {
  general: {
    cache_ttl_seconds: number;
  };
  layout: {
    rows: RowConfig[];
  };
  segments: {
    model: SegmentConfig;
    directory: SegmentConfig;
    git: GitSegmentConfig;
    worktrees: SegmentConfig;
    languages: LanguagesSegmentConfig;
    context: ContextSegmentConfig;
  };
  palette: {
    mauve: [number, number, number];
    peach: [number, number, number];
    yellow: [number, number, number];
    green: [number, number, number];
    blue: [number, number, number];
    pink: [number, number, number];
    maroon: [number, number, number];
    base: [number, number, number];
    crust: [number, number, number];
    [key: string]: [number, number, number];
  };
}

const DEFAULT_CONFIG: StatuslineConfig = {
  general: {
    cache_ttl_seconds: 5,
  },
  layout: {
    rows: [
      {
        segments: ["model", "directory", "git", "worktrees", "languages", "context"],
        style: "background",
        separator: "powerline",
        first_separator: "powerline",
        last_separator: "powerline",
      },
    ],
  },
  segments: {
    model: { color: "mauve" },
    directory: { color: "peach" },
    git: { color: "yellow", colorized_status: false },
    worktrees: { color: "pink" },
    languages: {
      color: "green",
      modules: ["python", "nodejs", "bun", "deno", "golang", "rust", "ruby", "c"],
    },
    context: {
      color: "blue",
      warn_color: "maroon",
      warn_threshold: 80,
      bar_width: 10,
      bar_filled: "█",
      bar_empty: "░",
    },
  },
  palette: {
    mauve: [202, 158, 230],
    peach: [239, 159, 118],
    yellow: [229, 200, 144],
    green: [166, 209, 137],
    blue: [137, 180, 250],
    pink: [244, 184, 228],
    maroon: [234, 153, 156],
    base: [48, 52, 70],
    crust: [35, 38, 52],
  },
};

async function loadConfig(): Promise<StatuslineConfig> {
  const configPath = join(
    process.env.HOME ?? "~",
    ".claude",
    "statusline.toml",
  );
  const file = Bun.file(configPath);
  if (!(await file.exists())) return DEFAULT_CONFIG;

  try {
    const raw = parseToml(await file.text()) as Record<string, unknown>;
    return deepMerge(DEFAULT_CONFIG, raw) as StatuslineConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

// Deep merge: target wins on primitives, source overrides recursively for objects/arrays
function deepMerge(target: unknown, source: unknown): unknown {
  if (
    typeof target !== "object" ||
    target === null ||
    typeof source !== "object" ||
    source === null
  ) {
    return source ?? target;
  }
  if (Array.isArray(source)) return source;
  const result = { ...(target as Record<string, unknown>) };
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    result[k] = deepMerge(result[k], v);
  }
  return result;
}

// ─── Separator glyphs ─────────────────────────────────────────────────────────

// Each style has: { mid, left_cap, right_cap }
// "mid" is the separator between two segments (transition arrow)
// "left_cap" / "right_cap" are the leading/trailing end cap glyphs
const SEPARATOR_GLYPHS: Record<
  SeparatorStyle,
  { mid: string; left_cap: string; right_cap: string }
> = {
  powerline: { mid: "", left_cap: "", right_cap: "" },
  slant: { mid: "", left_cap: "", right_cap: "" },
  round: { mid: "", left_cap: "", right_cap: "" },
  straight: { mid: "│", left_cap: "│", right_cap: "│" },
  none: { mid: " ", left_cap: "", right_cap: "" },
};

// ─── ANSI rendering ───────────────────────────────────────────────────────────

const RESET = "\x1b[0m";

function makeBg(rgb: [number, number, number]): string {
  return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}
function makeFg(rgb: [number, number, number]): string {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function makeColors(palette: StatuslineConfig["palette"]) {
  const bg = (name: string): string => {
    const rgb = palette[name];
    if (!rgb) return "";
    return makeBg(rgb);
  };
  const fg = (name: string): string => {
    const rgb = palette[name];
    if (!rgb) return "";
    return makeFg(rgb);
  };

  const crustRgb = palette.crust;
  const fgCrust = makeFg(crustRgb);

  return {
    bg,
    fg,
    fgCrust,
    // Classic background style segment
    segment: (color: string, content: string) =>
      `${bg(color)}${fgCrust}${content}${RESET}`,
    // End cap for background-style rows: base bg with segment color fg
    endcap: (color: string, content: string) =>
      `${bg("base")}${fg(color)}${content}${RESET}`,
    error: (content: string) =>
      `${bg("maroon")}${fgCrust} ERROR: ${content} ${RESET}`,
  };
}

// ─── Row renderer ─────────────────────────────────────────────────────────────

// A segment slot: the color name + rendered content (plain text, no ANSI)
interface SegmentSlot {
  name: string;
  color: string;
  content: string; // no ANSI; row renderer applies colors
}

/**
 * Render a row from a list of segment slots.
 *
 * "background" style — classic powerline: each slot gets a colored bg, dark
 * text, with a powerline arrow transition between adjacent segments.
 *
 * "foreground" style — minimal: segments share the base bg; each slot's color
 * is used as fg for its content, with a subtle separator between them.
 * Suitable for a denser secondary row.
 */
function renderRow(
  slots: SegmentSlot[],
  row: RowConfig,
  palette: StatuslineConfig["palette"],
): string {
  if (slots.length === 0) return "";

  const sepGlyphs = SEPARATOR_GLYPHS[row.separator] ?? SEPARATOR_GLYPHS.powerline;
  const firstGlyphs = SEPARATOR_GLYPHS[row.first_separator] ?? SEPARATOR_GLYPHS.powerline;
  const lastGlyphs = SEPARATOR_GLYPHS[row.last_separator] ?? SEPARATOR_GLYPHS.powerline;

  const parts: string[] = [];

  if (row.style === "background") {
    // ── Background style: colored bg per segment, dark fg text ──
    const baseBg = makeBg(palette.base);
    const crustFg = makeFg(palette.crust);

    // Leading cap: rendered in base bg, first-segment color as fg
    if (row.first_separator !== "none") {
      const firstRgb = palette[slots[0]!.color];
      const firstBg = firstRgb ? makeBg(firstRgb) : "";
      const firstFg = firstRgb ? makeFg(firstRgb) : "";
      parts.push(`${baseBg}${firstFg}${firstGlyphs.left_cap}${RESET}`);
      // Open the first segment bg
      parts.push(`${firstBg}${crustFg}`);
    } else {
      const firstRgb = palette[slots[0]!.color];
      const firstBg = firstRgb ? makeBg(firstRgb) : "";
      parts.push(`${firstBg}${crustFg}`);
    }

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const rgb = palette[slot.color];
      const segBg = rgb ? makeBg(rgb) : "";
      const segFg = rgb ? makeFg(rgb) : "";

      if (i > 0) {
        // Transition: previous segment color bg → arrow → this segment color bg
        const prevRgb = palette[slots[i - 1]!.color];
        const prevBg = prevRgb ? makeBg(prevRgb) : "";
        // Arrow: bg is current segment, fg is previous segment (to make the arrow shape)
        parts.push(
          `${RESET}${segBg}${prevBg ? `\x1b[38;2;${prevRgb![0]};${prevRgb![1]};${prevRgb![2]}m` : ""}${sepGlyphs.mid}${RESET}${segBg}${crustFg}`,
        );
      }

      parts.push(slot.content);

      // Close segment if last
      if (i === slots.length - 1) {
        if (row.last_separator !== "none") {
          parts.push(`${RESET}${baseBg}${segFg}${lastGlyphs.right_cap}${RESET}`);
        } else {
          parts.push(RESET);
        }
      }
    }
  } else {
    // ── Foreground style: base bg, each segment's color as fg text ──
    const baseBg = makeBg(palette.base);

    if (row.first_separator !== "none") {
      const firstRgb = palette[slots[0]!.color];
      const firstFg = firstRgb ? makeFg(firstRgb) : "";
      parts.push(`${baseBg}${firstFg}${firstGlyphs.left_cap}${RESET}`);
    }

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      const rgb = palette[slot.color];
      const segFg = rgb ? makeFg(rgb) : "";

      if (i > 0) {
        // Separator between segments: use previous segment's color as fg
        const prevRgb = palette[slots[i - 1]!.color];
        const prevFg = prevRgb ? makeFg(prevRgb) : "";
        parts.push(`${baseBg}${prevFg}${sepGlyphs.mid}${RESET}`);
      }

      parts.push(`${baseBg}${segFg}${slot.content}${RESET}`);

      if (i === slots.length - 1 && row.last_separator !== "none") {
        const lastRgb = palette[slot.color];
        const lastFg = lastRgb ? makeFg(lastRgb) : "";
        parts.push(`${baseBg}${lastFg}${lastGlyphs.right_cap}${RESET}`);
      }
    }
  }

  return parts.join("");
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_DIR = join(process.env.TMPDIR ?? "/tmp", "claude-statusline");

function hashKey(projectDir: string): string {
  return createHash("md5").update(projectDir).digest("hex").slice(0, 8);
}

async function withCache<T>(
  key: string,
  projectDir: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cacheFile = join(CACHE_DIR, `${hashKey(projectDir)}-${key}.json`);
  const file = Bun.file(cacheFile);
  if (await file.exists()) {
    try {
      const entry = (await file.json()) as { data: T; timestamp: number };
      if (Date.now() - entry.timestamp < ttlMs) return entry.data;
    } catch {
      // Corrupt cache entry — fall through to fetcher
    }
  }
  const data = await fetcher();
  // Best-effort write; don't block on cache failures
  Bun.write(cacheFile, JSON.stringify({ data, timestamp: Date.now() })).catch(
    () => { },
  );
  return data;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

// Get minimal environment for subprocess calls (PATH + version manager vars)
function getMinimalEnv(): Record<string, string> {
  const needed: Record<string, string> = {};
  const pick = (key: string) => {
    const v = process.env[key];
    if (v != null) needed[key] = v;
  };
  pick("PATH");
  pick("HOME");
  for (const key of [
    "PYENV_ROOT", "PYENV_VERSION", "PYENV_SHELL",
    "NVM_DIR", "NVM_BIN",
    "RBENV_ROOT", "RBENV_VERSION",
    "GOROOT", "GOPATH",
    "CARGO_HOME", "RUSTUP_HOME",
    "MISE_DATA_DIR", "MISE_CONFIG_DIR",
  ]) {
    pick(key);
  }
  return needed;
}

// Execute command directly and return stdout, or "failed"
async function execCommand(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<string> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [text] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (proc.exitCode !== 0) return "failed";
    return text.trim();
  } catch {
    return "failed";
  }
}

// Race a promise against a timeout, returning fallback if too slow
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// ─── Git ──────────────────────────────────────────────────────────────────────

const GIT_STATUS_PATTERNS = {
  modified: /^ M/,
  added: /^A/,
  deleted: /^.?D/,
  untracked: /^\?\?/,
};

async function isGitRepo(cwd: string, env: Record<string, string>): Promise<boolean> {
  return (await execCommand("git", ["rev-parse", "--git-dir"], cwd, env)) !== "failed";
}

async function getGitBranch(cwd: string, env: Record<string, string>): Promise<string> {
  const branch = await execCommand("git", ["branch", "--show-current"], cwd, env);
  return branch || "detached";
}

async function getGitStatus(
  cwd: string,
  env: Record<string, string>,
): Promise<{ modified: number; added: number; deleted: number; untracked: number }> {
  const status = await execCommand("git", ["status", "--porcelain"], cwd, env);
  if (!status) return { modified: 0, added: 0, deleted: 0, untracked: 0 };
  const lines = status.split("\n");
  return {
    modified: lines.filter((l) => GIT_STATUS_PATTERNS.modified.test(l)).length,
    added: lines.filter((l) => GIT_STATUS_PATTERNS.added.test(l)).length,
    deleted: lines.filter((l) => GIT_STATUS_PATTERNS.deleted.test(l)).length,
    untracked: lines.filter((l) => GIT_STATUS_PATTERNS.untracked.test(l)).length,
  };
}

// ─── Worktrunk ────────────────────────────────────────────────────────────────

// Returns the count of non-current worktrees where a Claude Code session is
// waiting on user input (marker value contains "💬").
async function getWaitingWorktreeCount(
  cwd: string,
  env: Record<string, string>,
): Promise<number> {
  const output = await execCommand(
    "git",
    ["config", "--get-regexp", "worktrunk\\.state\\..*\\.marker"],
    cwd,
    env,
  );
  if (output === "failed" || !output) return 0;
  let count = 0;
  for (const line of output.split("\n")) {
    const match = line.match(/^worktrunk\.state\.(.+)\.marker\s+(.+)$/);
    if (!match) continue;
    try {
      const data = JSON.parse(match[2] ?? "{}") as { marker?: string };
      if (data.marker?.includes("💬")) count++;
    } catch {
      // Skip malformed entries
    }
  }
  return count;
}

// ─── Language detection (Starship passthrough) ────────────────────────────────

async function detectLanguagesViaStarship(
  projectDir: string,
  modules: string[],
  env: Record<string, string>,
): Promise<LanguageInfo[]> {
  const results = await Promise.all(
    modules.map(async (mod) => {
      const output = await execCommand(
        "starship",
        ["module", mod, "-p", projectDir],
        projectDir,
        env,
      );
      if (!output || output === "failed") return null;
      // Strip ANSI escapes, keep Nerd Font unicode icons
      // eslint-disable-next-line no-control-regex
      const clean = output.replace(/\u001b\[[0-9;]*m/g, "").trim();
      if (!clean) return null;
      // Find the version token (e.g. "v1.3.11") and treat everything else as the label.
      // Starship modules vary: some prepend "via ", some don't. We want the icon glyph
      // and version regardless of format prefix.
      const versionMatch = clean.match(/v?\d+\.\d+[\.\d]*/);
      const version = versionMatch ? versionMatch[0] : undefined;
      // Label: strip version token and "via " prefix, keep the first non-ascii cluster (the icon)
      const labelRaw = clean.replace(versionMatch?.[0] ?? "", "").replace(/\bvia\b/g, "").trim();
      const icon = labelRaw || mod;
      return { icon, version } as LanguageInfo;
    }),
  );
  return results.filter((r): r is LanguageInfo => r !== null);
}

// ─── Context bar ──────────────────────────────────────────────────────────────

function renderContextBar(
  percentage: number,
  width: number,
  filled: string,
  empty: string,
): string {
  const filledCount = Math.round((percentage / 100) * width);
  const emptyCount = width - filledCount;
  return filled.repeat(filledCount) + empty.repeat(emptyCount) + ` ${percentage}%`;
}

// Resolve color based on threshold config and a numeric value
function resolveThresholdColor(value: number, config: ThresholdConfig): string {
  if (
    config.critical_color != null &&
    config.critical_threshold != null &&
    value >= config.critical_threshold
  ) {
    return config.critical_color;
  }
  if (
    config.warn_color != null &&
    config.warn_threshold != null &&
    value >= config.warn_threshold
  ) {
    return config.warn_color;
  }
  return config.color;
}

// ─── Explain mode ─────────────────────────────────────────────────────────────

interface ExplainData {
  context: SessionContext;
  config_path: string;
  config: StatuslineConfig;
  segments: Record<string, unknown>;
  cache: Record<string, "hit" | "miss">;
  timings: Record<string, number>;
}

// ─── Segment content builders ─────────────────────────────────────────────────

// Returns a map of segment name → SegmentSlot (or null if the segment is not
// applicable for this context). The row renderer decides how to color/style them.
async function buildSegmentSlots(
  context: SessionContext,
  config: StatuslineConfig,
  env: Record<string, string>,
  explainData: ExplainData | null,
): Promise<Map<string, SegmentSlot>> {
  const slots = new Map<string, SegmentSlot>();
  const ttlMs = config.general.cache_ttl_seconds * 1000;
  const projectDir = context.workspace?.project_dir ?? "ERROR: Missing Project Dir";
  const displayDir = projectDir.split("/").pop() ?? "ERROR: Path Split";
  const model = context.model?.display_name.split(" ")[0] ?? "! No Model";

  // ── Model ──
  slots.set("model", {
    name: "model",
    color: config.segments.model.color,
    content: ` ${model} `,
  });
  if (explainData) explainData.segments["model"] = { model };

  // ── Directory ──
  slots.set("directory", {
    name: "directory",
    color: config.segments.directory.color,
    content: ` ${displayDir} `,
  });
  if (explainData) explainData.segments["directory"] = { displayDir, projectDir };

  // ── Parallel fetch: git repo check + worktree waiting count (400ms timeout) ──
  const t0 = Date.now();
  const [gitRepo, waitingCount] = await Promise.all([
    withCache("git-repo", projectDir, ttlMs, () => isGitRepo(projectDir, env)),
    withTimeout(
      withCache("wt-waiting", projectDir, ttlMs, () =>
        getWaitingWorktreeCount(projectDir, env),
      ),
      400,
      0,
    ),
  ]);

  if (explainData) explainData.timings["git+wt-parallel"] = Date.now() - t0;

  // ── Git ──
  if (gitRepo) {
    const t1 = Date.now();
    const [branch, status] = await Promise.all([
      withCache("git-branch", projectDir, ttlMs, () => getGitBranch(projectDir, env)),
      withCache("git-status", projectDir, ttlMs, () => getGitStatus(projectDir, env)),
    ]);
    if (explainData) explainData.timings["git-branch+status"] = Date.now() - t1;

    const gitCfg = config.segments.git;
    let gitContent = `  ${branch}`;

    if (status.modified > 0 || status.added > 0 || status.deleted > 0 || status.untracked > 0) {
      gitContent += " ";
    }

    // colorized_status: emit inline ANSI for status indicators when enabled.
    // This is only meaningful in foreground-style rows (where the row renderer
    // won't be overriding the fg color of the whole segment), but we apply it
    // regardless and let the terminal do the right thing.
    if (gitCfg.colorized_status) {
      // Status indicator colors (hardcoded against Catppuccin Frappe, same palette)
      const STATUS_COLORS: Record<string, [number, number, number]> = {
        modified: [229, 200, 144], // yellow
        added: [166, 209, 137], // green
        deleted: [231, 130, 132], // red
        untracked: [148, 226, 213], // teal
      };
      const colorIndicator = (
        rgb: [number, number, number],
        indicator: string,
      ) => `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${indicator}`;
      const reset = RESET;
      const indicators: string[] = [];
      if (status.modified > 0) indicators.push(`${colorIndicator(STATUS_COLORS.modified!, "!")}${reset}`);
      if (status.added > 0) indicators.push(`${colorIndicator(STATUS_COLORS.added!, "+")}${reset}`);
      if (status.deleted > 0) indicators.push(`${colorIndicator(STATUS_COLORS.deleted!, "✘")}${reset}`);
      if (status.untracked > 0) indicators.push(`${colorIndicator(STATUS_COLORS.untracked!, "?")}${reset}`);
      gitContent += indicators.join("");
    } else {
      const statusParts: string[] = [];
      if (status.modified > 0) statusParts.push("!");
      if (status.added > 0) statusParts.push("+");
      if (status.deleted > 0) statusParts.push("✘");
      if (status.untracked > 0) statusParts.push("?");
      gitContent += statusParts.join("");
    }

    gitContent += " ";
    slots.set("git", {
      name: "git",
      color: gitCfg.color,
      content: gitContent,
    });

    if (explainData) {
      explainData.segments["git"] = {
        branch,
        status,
        colorized_status: gitCfg.colorized_status,
      };
    }

    // ── Worktrees ──
    // Show a count badge of worktrees where a Claude session is waiting on input.
    // Hidden entirely when count is 0 — only surfaces when attention is needed.
    if (waitingCount > 0) {
      slots.set("worktrees", {
        name: "worktrees",
        color: config.segments.worktrees.color,
        content: `  ${waitingCount} `,
      });
      if (explainData) {
        explainData.segments["worktrees"] = { waiting: waitingCount };
      }
    }
  }

  // ── Languages (Starship passthrough) ──
  const t2 = Date.now();
  const languages = await withCache("languages", projectDir, ttlMs, () =>
    detectLanguagesViaStarship(projectDir, config.segments.languages.modules, env),
  );
  if (explainData) explainData.timings["languages"] = Date.now() - t2;

  if (languages.length > 0) {
    const langParts = languages.map((lang) =>
      lang.version ? `${lang.icon} ${lang.version}` : lang.icon,
    );
    slots.set("languages", {
      name: "languages",
      color: config.segments.languages.color,
      content: ` ${langParts.join(" ")} `,
    });
    if (explainData) explainData.segments["languages"] = { detected: languages };
  }

  // ── Context window ──
  if (context.context_window) {
    const { total_input_tokens, total_output_tokens, context_window_size } =
      context.context_window;
    const totalTokens = total_input_tokens + total_output_tokens;
    const percentage = Math.round((totalTokens / context_window_size) * 100);
    const ctxConfig = config.segments.context;
    const color = resolveThresholdColor(percentage, ctxConfig);
    const bar = renderContextBar(percentage, ctxConfig.bar_width, ctxConfig.bar_filled, ctxConfig.bar_empty);

    slots.set("context", {
      name: "context",
      color,
      content: ` ${bar} `,
    });
    if (explainData) {
      explainData.segments["context"] = {
        totalTokens,
        context_window_size,
        percentage,
        color,
        bar,
      };
    }
  }

  return slots;
}

// ─── Main statusline builder ──────────────────────────────────────────────────

async function buildStatusline(
  context: SessionContext,
  config: StatuslineConfig,
  env: Record<string, string>,
  explain: boolean,
): Promise<string> {
  const explainData: ExplainData | null = explain
    ? {
      context,
      config_path: join(process.env.HOME ?? "~", ".claude", "statusline.toml"),
      config,
      segments: {},
      cache: {},
      timings: {},
    }
    : null;

  // Build all segment content (data fetching happens here)
  const slots = await buildSegmentSlots(context, config, env, explainData);

  // Validate row count
  const rows = config.layout.rows;
  if (rows.length === 0) {
    throw new Error("layout.rows must contain at least one row");
  }
  if (rows.length > 3) {
    throw new Error(`layout.rows has ${rows.length} rows — maximum is 3`);
  }

  // Render each row
  const renderedRows: string[] = [];
  for (const row of rows) {
    // Collect slots for this row (skip segments with no data, e.g. git when not in a repo)
    const rowSlots: SegmentSlot[] = row.segments
      .map((name) => slots.get(name))
      .filter((s): s is SegmentSlot => s !== undefined);

    if (rowSlots.length === 0) continue;

    renderedRows.push(renderRow(rowSlots, row, config.palette));
  }

  if (explain && explainData) {
    process.stdout.write(JSON.stringify(explainData, null, 2) + "\n");
    return "";
  }

  // Join rows with a newline
  return renderedRows.join("\n");
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const CAPTURE_PATH = join(process.env.HOME ?? "~", ".claude", "statusline-input.json");

const HELP_TEXT = `\
winline — Claude Code powerline statusline renderer

USAGE
  winline [FLAGS]
  echo '<context JSON>' | winline

FLAGS
  -p, --print    Render against the current directory using mock session data.
                 Runs all real detectors (git, languages, etc.) without needing
                 an active Claude Code session. Fast visual iteration.
  -c, --capture  Drop-in replacement for the winline command in Claude Code
                 settings. Saves the raw context JSON to
                 ~/.claude/statusline-input.json, then renders normally.
      --explain  Read the last captured context from ~/.claude/statusline-input.json
                 and dump structured diagnostic JSON (segments, timings, config).
                 Pipe to jq for readable output: winline --explain | jq .
  -h, --help     Print this help text and exit.

CONFIGURATION
  ~/.claude/statusline.toml        — layout and segment options (optional)
  ~/.claude/statusline-input.json  — last captured context (written by --capture)
`;

async function main() {
  const args = process.argv.slice(2);
  const hasFlag = (...flags: string[]) => flags.some((f) => args.includes(f));

  if (hasFlag("-h", "--help")) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  const capture = hasFlag("-c", "--capture");
  const explain = hasFlag("--explain");
  const print = hasFlag("-p", "--print");

  let step = "initializing";
  try {
    let context: SessionContext;

    if (print) {
      step = "building mock context";
      const cwd = process.cwd();
      context = {
        hook_event_name: "notification",
        session_id: "preview",
        transcript_path: "",
        cwd,
        model: { id: "claude-sonnet-4-5", display_name: "Claude Sonnet" },
        workspace: { current_dir: cwd, project_dir: cwd },
        version: "0.0.0",
        output_style: { name: "default" },
        context_window: {
          total_input_tokens: 45000,
          total_output_tokens: 12000,
          context_window_size: 200000,
        },
      };
    } else if (explain) {
      step = "reading capture file";
      const file = Bun.file(CAPTURE_PATH);
      if (!(await file.exists())) {
        throw new Error(
          `no capture file found at ${CAPTURE_PATH} — run winline with --capture first`,
        );
      }
      const contextStr = await file.text();
      step = "parsing captured context JSON";
      context = JSON.parse(contextStr) as SessionContext;
    } else {
      step = "reading stdin";
      const contextStr = await Bun.stdin.text();

      step = "parsing context JSON";
      context = JSON.parse(contextStr) as SessionContext;

      if (capture) {
        step = "saving capture file";
        await Bun.write(CAPTURE_PATH, contextStr);
      }
    }

    step = "validating context";
    if (!context.workspace?.project_dir) {
      throw new Error("missing workspace.project_dir");
    }

    step = "loading config";
    const config = await loadConfig();

    step = "building statusline";
    const env = getMinimalEnv();
    const statusline = await buildStatusline(context, config, env, explain);
    if (!explain) process.stdout.write(statusline + "\n");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const msg = detail ? `${step}: ${detail}` : step;
    const c = makeColors(DEFAULT_CONFIG.palette);
    process.stdout.write(c.error(msg) + "\n");
    process.exit(0);
  }
}

main();
