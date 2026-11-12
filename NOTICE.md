# Notice and attributions

pi-lumen is MIT licensed (see `LICENSE`). It is an original, much smaller implementation
that takes ideas, and a few small ported functions, from the projects below. Each ported
function carries a header comment naming its origin.

| Project | License | What pi-lumen takes |
|---|---|---|
| [nicobailon/pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) v0.22.0 | MIT (declared in `package.json`; the repository has **no LICENSE file**) | segment set, above/below placement, thinking colors and the rainbow effect (`theme.ts › rainbow`), 70/90 % context thresholds, cache hit-rate formula and bands (`segments.ts`), git porcelain parsing and `GIT_OPTIONAL_LOCKS=0` (`git-status.ts`) |
| [narumiruna/pi-extensions › pi-stamp](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-stamp) v0.54.1 | MIT | right aligned dim timestamp line, `appendEntry` + `registerEntryRenderer`, deferred user stamp (`stamp.ts`) |
| [heyhuynhgiabuu/pi-pretty](https://github.com/heyhuynhgiabuu/pi-pretty) v0.10.0 | MIT | compact tool rows with the built-in tools overridden by renderers only, `formatThinkingDuration` (`working-indicator.ts`), prompt glyph, per-row hidden-thinking labels (`thinking-label.ts`), `embedWorkingStatus` editor subclass (`prompt-editor.ts`) |
| [gsanhueza/pi-token-speed](https://github.com/gsanhueza/pi-token-speed) v0.12.0 | MIT | tokens/s sliding window, time-to-first-token excluded, burst-after-stall span extension (`core/sliding-window.ts › getTps`), reconcile with provider usage at message end (`stats.ts › TpsTracker`) |

Upstream credits carried over: pi-powerline-footer credits Powerlevel10k and
[oh-my-pi](https://github.com/can1357/oh-my-pi); pi-pretty credits oh-my-pi and
`sting8k/pi-droid-styling` (the `claudecode` look).

## Upstream copyright notices

The MIT license requires the copyright notice of the original authors to be kept with the ported code:

- pi-powerline-footer: Copyright (c) Nico Bailon (declared `MIT` in `package.json`; the repository ships no LICENSE file)
- pi-stamp (narumiruna/pi-extensions): Copyright (c) 2026 narumiruna
- pi-pretty: Copyright (c) 2025 huynhgiabuu
- pi-token-speed: Copyright (c) 2026 Gabriel Sanhueza

Permission is granted under the same MIT terms reproduced in `LICENSE`.
