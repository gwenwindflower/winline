# winline

A standalone Claude Code statusline tool. Reads Claude Code session context JSON from stdin, renders a Catppuccin Frappe-themed powerline statusline to stdout. Distributed as a compiled Bun binary.

## Project structure

```text
winline/
├── statusline.ts          # Entire implementation (single file)
├── statusline.toml        # Reference config — copy to ~/.claude/statusline.toml
├── package.json           # build / dev / install:local scripts, smol-toml dependency
├── tsconfig.json          # Bun-compatible TS config (jsonc — comments are valid)
├── dist/                  # Compiled binary output (gitignored)
│   └── winline            # Native binary via `bun build --compile`
└── STATUSLINE_TOOL.md     # Full design doc: architecture, phases, decisions
```

## Key commands

```bash
bun run dev          # Run from source (bun run statusline.ts)
bun run build        # Compile to dist/winline (~50-90MB, embeds JSC runtime)
bun run install:local  # Build + install to ~/.local/bin/winline
bun test             # (no tests yet)
```

### Dev flags

```bash
# -p / --print: render against current directory using mock session data.
# Runs all real detectors (git, languages, worktrees) — no active Claude session needed.
bun run dev -- -p

# -c / --capture: drop-in for the Claude Code "command" setting.
# Saves raw context JSON to ~/.claude/statusline-input.json, then renders normally.
# Use this instead of "winline" in settings.json while iterating.

# --explain: read the last capture and dump structured diagnostic JSON.
# Requires a prior --capture run (or any write to statusline-input.json).
bun run dev -- --explain | jq .
winline --explain | jq .

# -h / --help: print flag reference and exit.
winline --help

# Benchmark
time echo '<context JSON>' | winline
```

## Architecture

Single-file, all phases integrated:

1. **Config** — `loadConfig()` reads `~/.claude/statusline.toml` via `smol-toml`, deep-merges with `DEFAULT_CONFIG`. Partial configs are valid.
2. **Cache** — `withCache<T>()` writes `{ data, timestamp }` JSON to `$TMPDIR/claude-statusline/<hash>-<key>.json`. TTL default 5s. Cached: git branch/status, waiting worktree count, starship module calls.
3. **Segment slots** — `buildSegmentSlots()` fires all independent data fetches in parallel, returning a `Map<name, SegmentSlot>` of `{ name, color, content }` plain-text entries. No ANSI at this stage.
4. **Row renderer** — `renderRow(slots, row, palette)` applies ANSI based on `row.style`:
   - `"background"` — classic powerline: colored bg per segment, dark fg text, arrow transitions
   - `"foreground"` — minimal: base bg shared, segment color used as fg text
5. **Layout resolution** — `config.layout.rows` is required (1–3 rows). Each row is rendered separately and joined with `\n`. Exceeding 3 rows throws a caught error that renders as an error segment.
6. **Separator glyphs** — `SEPARATOR_GLYPHS` table maps `SeparatorStyle` → `{ mid, left_cap, right_cap }`. Styles: `powerline`, `slant`, `round`, `straight`, `none`.

## Segments

| Segment | Color | Data source | Notes |
| --- | --- | --- | --- |
| model | mauve | stdin context | No subprocess |
| directory | peach | stdin context | Workspace root basename only |
| git | yellow | `git branch`, `git status --porcelain` | Status indicators: `! + ✘ ?`; `colorized_status` option |
| worktrees | pink | `git config --get-regexp worktrunk.state.*.marker` | Count badge `N` of sessions waiting on input (`💬`); hidden when 0; no `wt` binary needed |
| languages | green | `starship module <name> -p <dir>` | Starship is a hard dependency — no fallback |
| context | blue/maroon | stdin context | Block bar `████░░ 45%`, switches color at warn threshold |

## Key implementation details

**Starship passthrough**: Language detection calls `starship module <name> -p <projectDir>` in parallel for each configured module. Strips ANSI escapes, extracts version token (`v\d+\.\d+`), strips `"via "` prefix that some modules emit (e.g. deno). No file-detection or version-command logic in this codebase.

**Map serialization**: `withCache` serializes Maps to plain objects for JSON. `getWaitingWorktreeCount` returns a plain `number` — no Map reconstruction needed.

**Error formatting**: `main()` catches all errors and renders a maroon-background error segment rather than crashing silently. `--explain` dumps structured JSON and exits before rendering.

**ThresholdConfig**: `resolveThresholdColor(value, config)` supports `warn_color`/`warn_threshold` and `critical_color`/`critical_threshold`. Currently wired to context %; the interface is reusable for future segments (cost, git change counts, etc.).

## Claude Code integration

```json
{
  "statusLine": {
    "type": "command",
    "command": "winline",
    "padding": 0
  }
}
```

Deploy: `bun run install:local`

## Dependencies

- **Runtime**: Bun (hard — binary embeds JSC, no Node needed)
- **`smol-toml`**: Zero-dep TOML parser (~8KB). Only npm dependency.
- **`starship`**: Hard dependency for the languages segment. Must be in PATH.
- **`wt` (worktrunk)**: Optional. The worktrees segment reads `worktrunk.state.*.marker` keys written by worktrunk's Claude Code hooks — without it the keys won't exist and the segment stays hidden. The `wt` binary itself is never called.
