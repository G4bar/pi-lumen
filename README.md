# pi-lumen

A small extension for [pi](https://pi.dev) (tested on pi 1.5.1): a powerline-style status line,
Claude Code–style thinking colors, compact `read`/`bash`/`edit`/`write` rows and transcript timestamps.

```text
anthropic · Haiku 5.5 │ think:high 12s │ 84k/200k 42% │ 5h 37% · 7d 12% │ CH 81% · 62 tok/s │ lumen │ main *2 +1
```

## Install

```bash
pi install git:github.com/G4bar/pi-lumen   # or: pi install /path/to/pi-lumen
```

No configuration is required. Try it once with `pi -e ./src/index.ts`.

## Status line

One line, `above` or `below` the editor. The native footer is replaced by an empty component that only
captures the git branch and the statuses other extensions set (e.g. pi-lens), shown as the last segment.

| Segment | Content |
|---|---|
| model | provider · model name |
| think | level, colored like pi's thinking border; `high`/`xhigh`/`max` use a rainbow; duration of the last thinking |
| context | `84k/200k 42%`, `?/200k` right after compaction; yellow > 70 %, red > 90 % |
| spend | API key → `$0.42`; Anthropic OAuth → `5h 37% · 7d 12%`; other OAuth → reported cost or `sub` |
| cache · tps | `CH 81%` (hit rate of the latest request; `CH --` after compaction/model change; hidden if the provider never reports cache) · `62 tok/s` |
| dir | basename of the working directory |
| git | branch, then `*unstaged +staged ?untracked` |
| ext | statuses from other extensions |

If the line does not fit, segments are dropped in this order: ext → git counters → dir → cache/tps →
spend → git branch. model, think and context always stay; the model name is truncated last.

**TPS** is `output_tokens / seconds(first content → message end)`. While streaming it is estimated as
chars/4; at message end it uses the exact `usage.output`. It is *not* server speed, and it does not
match the `tok/s` of pi-stamp, which starts at message creation and therefore includes the wait.

### Commands

- `/lumen` – show state
- `/lumen placement above|below|toggle`
- `/lumen on` / `/lumen off`

Placement and on/off are saved to `~/.pi/agent/pi-lumen.json` (pi has no API to write `settings.json`).

## Compact tools

`read`, `bash`, `edit`, `write` are re-registered with the SDK definition spread, so schemas,
`promptSnippet`/`promptGuidelines` and results are unchanged (the system prompt is byte-identical with and
without pi-lumen). Only the renderers change, and `execute` is delegated with the live `ctx.cwd`.

```text
● Bash (npm test)
  └ exit 0 · 12 lines · 3.1s
● Edit (src/a.ts)
  └ +3 -1 · 0.02s
```

Expand with pi's own key (shown in the hint). `find`/`grep`/`ls` are left alone.

## Thinking and working indicator

The working spinner is painted with the thinking level color. With thinking blocks hidden, the label reads
`Thinking… 12s` while running and `Thought` afterwards (the label is global in pi, so old rows share it);
the final duration is in the status line.

## Timestamps

A dim right-aligned `HH:mm:ss` under each user message and each run's final assistant message (not the
intermediate tool-use ones); the date appears when the day changes. **They are stored as custom entries in
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
    "tools": { "enabled": true, "previewLines": 40 },
    "prompt": { "icon": true },
    "hiddenStatusKeys": []
  }
}
```

`icons: "nerd"` adds Nerd Font glyphs. `prompt.icon` draws `❯` in the editor; it is skipped if another
extension already owns the editor. Tools are registered at load: changing `tools.enabled` needs a restart.
Keys such as `powerline` or `tokenSpeed` left by pi-powerline-footer are ignored and can be removed.

## ⚠ Unofficial quota endpoint

The 5h/7d numbers come from `GET https://api.anthropic.com/api/oauth/usage`, an **undocumented** endpoint,
called with your OAuth token **only** when the provider is `anthropic` and you use a subscription login.
It is cached (90 s), has a 3 s timeout and backs off exponentially (up to 10 min); the token is never logged.
It may change or disappear at any time, in which case the segment falls back to the cost. Using the token
outside the official client is your choice: disable with `"quota": { "enabled": false }`.

## Inspiration and credits

See [NOTICE.md](NOTICE.md). Ideas and a few small functions come from
[pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) (segments, colors, rainbow, cache
formula, git parsing), [pi-stamp](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-stamp)
(timestamp entries) and [pi-pretty](https://github.com/heyhuynhgiabuu/pi-pretty) (compact tool rows,
duration format, prompt glyph), which in turn credit Powerlevel10k and oh-my-pi. pi-powerline-footer
declares MIT but ships no LICENSE file.

## Development

```bash
npm install
npm run typecheck && npm test
```
