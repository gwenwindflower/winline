# winline

A powerline statusline for [Claude Code](https://claude.ai/code), rendered in your terminal using the [Catppuccin Frappe](https://github.com/catppuccin/catppuccin) palette. Reads session context from Claude Code's hook system and outputs a formatted, multi-row statusline to stdout.

## Prerequisites

- **[Bun](https://bun.sh)** — build toolchain and runtime
- **[Starship](https://starship.rs)** — required for the `languages` segment
- **[Nerd Fonts](https://www.nerdfonts.com)** — required for powerline glyphs and language icons
- **[worktrunk](https://github.com/anomalyco/worktrunk)** — optional, enables the `worktrees` segment

## Installation

Clone the repo and install the binary to `~/.local/bin`:

```bash
git clone https://github.com/anomalyco/winline
cd winline
bun install
bun run install:local
```

Make sure `~/.local/bin` is on your `PATH`. Then wire winline into Claude Code by adding this to your `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "winline",
    "padding": 0
  }
}
```

That's it. Open a new Claude Code session and the statusline will appear.

## Configuration

winline reads `~/.claude/statusline.toml` on every render. The file is optional — all values have defaults. Copy the reference config to get started:

```bash
cp statusline.toml ~/.claude/statusline.toml
```

The reference config is fully commented and shows every available option with its default value. The sections below summarize the key customization points.

### Layout

Define one to three rows. Each row has a `style`, `separator`, and a list of `segments`:

```toml
[[layout.rows]]
style     = "background"   # "background" or "foreground"
separator = "powerline"    # "powerline" | "slant" | "round" | "straight" | "none"
segments  = ["model", "directory", "languages"]

[[layout.rows]]
style     = "foreground"
separator = "straight"
segments  = ["git", "worktrees", "context"]
```

**Styles:**

- `background` — classic powerline look: each segment gets a solid colored background with dark text and arrow transitions between segments
- `foreground` — minimal look: all segments share the base background color, and the segment color is applied to the text instead

**Separators:** control the glyph between segments and at the row edges. `first_separator` and `last_separator` can be set independently from `separator` to mix endcap and mid styles.

| Value | Glyph | Description |
| --- | --- | --- |
| `powerline` |  | Filled triangle arrows (classic powerline) |
| `slant` |  | Thin diagonal slashes |
| `round` |  | Rounded pill endcaps |
| `straight` | │ | Vertical bar |
| `none` | — | Space only, no glyph |

### Segments

Each segment has a `color` field and some have additional options. Any segment not included in a `layout.rows` entry is silently omitted.

| Segment | Default color | Description |
| --- | --- | --- |
| `model` | mauve | Active Claude model name |
| `directory` | peach | Workspace root directory (basename only) |
| `git` | yellow | Branch name + status indicators (`! + ✘ ?`) |
| `worktrees` | pink | Other worktrees with session state badges |
| `languages` | green | Language icons and versions via Starship |
| `context` | blue | Context window usage bar + percentage |

#### Git segment

```toml
[segments.git]
color            = "yellow"
colorized_status = true   # render each status indicator in its own color
```

When `colorized_status` is enabled, the status indicators (`!`, `+`, `✘`, `?`) are each rendered in a distinct color rather than inheriting the segment color. On `background`-style rows the setting is automatically ignored — inline fg colors produce unreadable text against the solid segment background. It only takes effect on `foreground`-style rows, where the base background is neutral.

#### Languages segment

```toml
[segments.languages]
color   = "green"
modules = ["python", "nodejs", "bun", "deno", "golang", "rust", "ruby", "c"]
```

Each entry maps to a Starship module name. Add or remove languages from the list. Module detection and icons follow your `starship.toml` config exactly — winline just calls `starship module <name>` and parses the output.

#### Context window segment

```toml
[segments.context]
color          = "blue"
warn_color     = "maroon"
warn_threshold = 80          # switches to warn_color at or above this %

# critical_color     = "red"
# critical_threshold = 95
```

Shows a block bar and percentage of context window used. Color transitions to `warn_color` at the threshold. Uncomment the `critical_*` lines (and add a `red` entry to `[palette]`) to add a second tier.

### Palette

All colors are defined in the `[palette]` table as `[R, G, B]` triplets. Defaults are Catppuccin Frappe. Override individual entries without needing to redeclare the full table:

```toml
[palette]
mauve  = [202, 158, 230]   # #CA9EE6 — Catppuccin Frappe default
peach  = [239, 159, 118]   # #EF9F76
# ... etc
```

To use a different Catppuccin variant (Latte, Macchiato, Mocha), replace the RGB values here. The Catppuccin palette reference is linked in the `statusline.toml` comments.

### Cache TTL

subprocess calls (git, starship) are cached to avoid re-running on every render:

```toml
[general]
cache_ttl_seconds = 5   # default
```

Increase this if the statusline feels slow. The stdin context (model, directory, context window) is always fresh — only subprocess-based segments are cached.

## Diagnostics

Two flags help when something looks wrong:

```bash
# Capture a session context snapshot and render normally
winline --capture

# Print structured diagnostic JSON from the last capture
winline --explain | jq .
```

Use `--capture` in your `settings.json` command while iterating on config, then `--explain` to inspect what data each segment is working with. Captured input is saved to `~/.claude/statusline-input.json`.

```bash
# Preview the statusline without an active Claude session
winline --print
```

`--print` runs against the current directory using mock session data — all real detectors (git, languages, worktrees) fire normally. Useful for tuning layout and colors without opening Claude Code.

## TODO

- [ ] Add output testing suite
- [ ] Add Homebrew tab for binary install
