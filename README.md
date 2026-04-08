# ✨📼  winline

A powerline statusline for [Claude Code](https://claude.ai/code), rendered in your terminal using the [Catppuccin Frappe](https://github.com/catppuccin/catppuccin) palette. Reads session context from Claude Code's hook system and outputs a formatted, multi-row statusline to stdout.

## A few possible styles

<img width="322" height="61" alt="Screenshot 2026-03-23 at 9 47 38 PM" src="https://github.com/user-attachments/assets/8096f08a-9395-48ae-9188-1aab952861c9" />
<br>
<img width="562" height="56" alt="Screenshot 2026-03-23 at 10 03 24 PM" src="https://github.com/user-attachments/assets/dd3aeba3-81a8-4d67-bc4a-c7c25ed094f1" />

<img width="557" height="65" alt="Screenshot 2026-03-23 at 10 08 55 PM" src="https://github.com/user-attachments/assets/126318f1-45da-4c95-a3e4-29f0dffafe45" />

## Dependencies

- **[Starship](https://starship.rs)** — required for the `languages` segment
- **[Nerd Fonts](https://www.nerdfonts.com)** — required for powerline glyphs and language icons

### Optional segments

- **[worktrunk](https://github.com/max-sixty/worktrunk)** — optional, enables the `worktrees` segment

### Development

- **[Bun](https://bun.sh)** — build toolchain and runtime

## Installation

### Homebrew

Currently only Homebrew is supported as a package manager for installation.

```bash
brew install g15r/tap/winline
```

Set Claude Code statusline command:

```json
{
  "statusLine": {
    "type": "command",
    "command": "winline",
    "padding": 0
  }
}

```

### Build from source

1. Clone the repo
2. Install dependencies with `bun install`
3. Run the bun task `bun run install:local` to add the binary to `~/.local/bin` (make sure this is available in PATH)
4. Update your Claude Code `settings.json` to use `winline` as the command for the statusline hook:
5. (optional) run `winline config init` to generate a starter config at `~/.config/winline/config.toml` (or `$XDG_CONFIG_HOME/winline/config.toml` if $XDG_CONFIG_HOME is set)

Install winline from source:

```bash
git clone https://github.com/gwenwindflower/winline
cd winline
bun install
bun run install:local
```

Set Claude Code statusline command:

```json
{
  "statusLine": {
    "type": "command",
    "command": "winline",
    "padding": 0
  }
}
```

## Configuration

winline reads its config from `$XDG_CONFIG_HOME/winline/config.toml`, falling back to `~/.config/winline/config.toml`. The file is optional — all values have defaults. Generate a starter config with:

```bash
winline config init
```

To see the resolved configuration (defaults merged with your overrides):

```bash
winline config
```

The generated config is fully commented and shows every available option with its default value. The sections below summarize the key customization points.

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
| `powerline` |  | Filled triangle arrows (classic powerline) |
| `slant` |  | Thin diagonal slashes |
| `round` |  | Rounded pill endcaps |
| `straight` | █ | Vertical bar |
| `none` | — | No glyph for minimalist setups |

### Segments

Each segment has a `color` field and some have additional options. Any segment not included in a `layout.rows` entry is silently omitted.

| Segment | Default color | Description |
| --- | --- | --- |
| `model` | mauve | Active Claude model name |
| `directory` | peach | Workspace root directory (basename only) |
| `git` | yellow | Branch name + status indicators (`! + ✘ ?`) |
| `worktrees` | pink | Other worktrees with session state badges (opt-in) |
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

All colors are defined in the `[palette]` table as `[R, G, B]` triplets. Defaults are Catppuccin Frappe. Full theme support coming shortly. Override individual entries without needing to redeclare the full table:

```toml
[palette]
mauve  = [202, 158, 230]   # #CA9EE6 — Catppuccin Frappe default
peach  = [239, 159, 118]   # #EF9F76
# ... etc
```

### Cache TTL

subprocess calls (git, starship) are cached to avoid re-running on every render:

```toml
[general]
cache_ttl_seconds = 5   # default
```

Increase this if the statusline feels slow. The stdin context (model, directory, context window) is always fresh — only subprocess-based segments are cached.

## Styling

Use `winline -p/--print` to quickly preview your config's output with mock data. Sends hardcoded input to all available segments so you can test every potential segment.

## Troubleshooting

Two flags help when something looks wrong:

```bash
# Capture a session context snapshot and render normally
winline --capture

# Print structured diagnostic JSON from the last capture
winline --explain | jq .
```

Use `--capture` in your `settings.json` command while iterating on config, then `--explain` to inspect what data each segment is working with. Captured input is saved alongside the config in the XDG config directory.

```bash
# Preview the statusline without an active Claude session
winline --print
```

## Roadmap

- [x] Add Homebrew tab for binary install
- [ ] Add output testing suite
- [ ] Add theme selection beyond Catppuccin Frappe
- [ ] Support multiple mock data sets for `--print`, to test different situations (e.g. maxxed out context window, dirty git status, etc.), and make these configurable (`print.data.<set name> = {...}`, `winline --print <set name>`)
