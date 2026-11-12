# pi-lumen

A small extension for [pi](https://pi.dev) (tested on pi 1.5.2): a powerline-style status line,
thinking-level colors, compact `read`/`bash`/`edit`/`write` rows and transcript timestamps.

```text
deepseek · V4 Pro │ think:high 12s │ 84k/200k 42% │ $0.42 │ CH 81% · 62 tok/s │ lumen │ main *2 +1
```

## Install

```bash
pi install git:github.com/G4bar/pi-lumen   # or: pi install /path/to/pi-lumen
```

No configuration is required. Try it once with `pi -e ./src/index.ts`.

## Status line

One line, `above` or `below` the editor. The native footer is replaced by an empty component that only
captures the git branch and the statuses other extensions publish (pi-sync, pi-lens LSP, …). Those statuses
are **not** drawn in the line by default (it stays clean): read them with `/status`, or opt individual keys
back in with `inlineStatusKeys`.

| Segment | Content |
|---|---|
| model | provider · model name |
| think | level, colored like pi's thinking border; `high`/`xhigh`/`max` use a rainbow; duration of the last thinking |
| context | `84k/200k 42%`, `?/200k` right after compaction; yellow > 70 %, red > 90 % |
| spend | API key → `$0.42`; subscription login → `5h 37% · 7d 12%` quota when available, otherwise reported cost or `sub` |
| cache · tps | `CH 81%` (hit rate of the latest request on the active branch; `CH --` after compaction/model change; hidden if the provider never reports cache) · `62 tok/s` |
| dir | basename of the working directory |
| git | branch, then `*unstaged +staged ?untracked` |
| ext | statuses of other extensions, only for the keys listed in `inlineStatusKeys` (none by default) |

If the line does not fit, segments are dropped in this order: ext → git counters → dir → cache/tps →
spend → git branch. model, think and context always stay; the model name is truncated last.

**TPS** is `output_tokens / seconds(first content → message end)`. While streaming it is estimated as
chars/4; at message end it uses the exact `usage.output`. It is *not* server speed, and it does not
match the `tok/s` of pi-stamp, which starts at message creation and therefore includes the wait.

### Commands

- `/status` – every status published by other extensions (`pi-sync`, `pi-lens · LSP`, unknown keys as-is),
  plus the loaded extensions with their command/tool counts. A snapshot shown as a notification; it needs the
  pi-lumen footer (with `/lumen off` pi's own footer shows the statuses). Richer details stay in each
  extension's own command (`/lens`, `/sync`).
- `/lumen` – show state
- `/lumen placement above|below|toggle`
- `/lumen on` / `/lumen off`

Placement and on/off are saved to `~/.pi/agent/pi-lumen.json` (pi has no API to write `settings.json`).

## Compact tools

`read`, `bash`, `edit`, `write` are re-registered with the SDK definition spread, so schemas,
`promptSnippet`/`promptGuidelines` and results are unchanged (the system prompt is byte-identical with and
without pi-lumen). Only the renderers change, and `execute` is delegated with the live `ctx.cwd` and the same
options pi passes to the built-ins (`shellCommandPrefix`, `shellPath`, `images.autoResize`, read on every call).

```text
● Bash (npm test)
  └ exit 0 · 12 lines · 3.1s · 14:32:07
● Edit (src/a.ts)
  └ +3 -1 · 0.02s · 14:32:11
```

The last field is the wall-clock **start** time of the call (date added when it is not today). It is written into
the tool result's `details` (`lumenAt`) by a `tool_result` handler, so pi persists it with the result: no extra
session entries, nothing sent to the model, and it is still there after a resume. Results recorded before this
show no time. Only `read`/`bash`/`edit`/`write` rows have it; `find`/`grep`/`ls` and other extensions' tools keep
their own rendering. `tools.time: false` turns it off.

Expand with pi's own key (shown in the hint). `read` expands to a syntax-highlighted body with a line-number
gutter (pi's own highlighter, no extra dependency; skipped above 80k characters); images are drawn by pi under
a one-line `image` row. `find`/`grep`/`ls` are left alone.

## Thinking and working indicator

The working spinner is painted with the thinking level color. With thinking blocks hidden, the label is
each row keeps its own label: the streaming row ticks `Thinking… 12s`, finished rows stay at `Thought for 12s`
(pi has one global label, so the component's setter is wrapped per row; if pi changes that class the wrapper
turns itself off). The status line shows the run total (`think:high 12s`).

## Timestamps

A dim right-aligned `HH:mm:ss` under each user message and each run's final assistant message (not the
intermediate tool-use ones; tool calls carry their own time on the result row, see Compact tools); the date appears when the day changes. **They are stored as custom entries in
the session file** (≈ 2 per exchange); they are never sent to the model. No backfill of older messages.
Set `stamp.enabled: false` to stop writing them; `stamp.duration: true` adds the run duration.

## Configuration

Optional, key `lumen` in `settings.json`:

```json
{
  "lumen": {
    "placement": "below",
    "separator": "│",
    "icons": "none",
    "git": { "statusTtlMs": 2000 },
    "quota": { "enabled": true, "ttlMs": 90000 },
    "stamp": { "enabled": true, "duration": false },
    "tools": { "enabled": true, "previewLines": 40, "time": true },
    "prompt": { "icon": true },
    "inlineStatusKeys": []
  }
}
```

`tools.enabled` is read from the global `settings.json` only (tools are registered at load, before pi's trust
decision about the project is known); every other key also honours the project `.pi/settings.json` as merged by pi.
`icons: "nerd"` adds Nerd Font glyphs. `prompt.icon` draws `❯` in the editor; it is skipped if another
extension already owns the editor. Tools are registered at load: changing `tools.enabled` needs a restart.
`inlineStatusKeys` is a list of status keys (as shown by `/status`, e.g. `["sync"]`) to keep in the status line.
Keys such as `powerline` (pi-powerline-footer) or `tokenSpeed` (pi-token-speed) are ignored and can be removed.

## Inspiration and credits

See [NOTICE.md](NOTICE.md). Ideas and a few small functions come from
[pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) (segments, colors, rainbow, cache
formula, git parsing), [pi-stamp](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-stamp)
(timestamp entries) and [pi-pretty](https://github.com/heyhuynhgiabuu/pi-pretty) (compact tool rows,
duration format, prompt glyph, per-row thinking labels) and
[pi-token-speed](https://github.com/gsanhueza/pi-token-speed) (tok/s sliding window), which in turn credit Powerlevel10k and oh-my-pi. pi-powerline-footer
declares MIT but ships no LICENSE file.

## Development

```bash
npm install
npm run typecheck && npm test
npm run test:e2e   # needs tmux and a working `pi`; set PI_BIN to override the binary
```

The e2e suite runs the real pi TUI inside tmux with an isolated agent dir, this checkout as the only extension
and a scripted mock model server (no network). It asserts on the rendered screen: tool rows, expansion,
the prompt box, `Working` in the border, status line, timestamps, markdown and per-row thinking labels.
