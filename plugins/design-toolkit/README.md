# Design Toolkit

**Version:** 0.10.2 | **Status:** Beta | **Author:** Varde Labs

Design review tooling for UI work: `design-spec` makes the review material, `ui-inspect` measures the screen first, `design-audit` lists what is generic or broken on an existing screen, and `clean-copy` cuts interface copy that should not exist.

## Install

See the repository README.

## Skills

| Skill | Fires on | Purpose |
|---|---|---|
| `design-spec` | Sending screenshots of a UI change, a reviewer asking to see a UI change or its states, a PR that changes a screen | Makes a quick card (one composed image) or a full sheet (a claude.ai Artifact republished each round). Starts from a state inventory checked against the server contract, captures headless at fixed viewports, 2x, light and dark, and checks the material before it goes out. |
| `ui-inspect` | Before capturing review material, after changing an app screen, "is anything clipped" | Measures the rendered screen at the design-spec viewports in light and dark: overflow, clipped and covered text, contrast, font fallback, broken images, small text, type sizes and faces, line length, sideways rows, and icons off the middle of their text, with per-repo exceptions in `.design-toolkit.json`. Each FAIL and WARN carries a fix. |
| `design-audit` | Before a redesign, a page that "looks AI-made", "audit this page" | Lints the source for generated-page tells (app or site rule set), measures the page with ui-inspect, captures it in light and dark, and orders every finding by the fix order with the shot that shows it. Presents through a design-spec card. Reports, never edits. |
| `clean-copy` | Writing or reviewing any user-facing string, "clean up the copy" | Cuts interface copy that should not exist (restated labels, pre-empted worries, scar tissue from fixed bugs) by a four-rung ladder, keeps legal, accessibility and safety text, and sets the shape of an error message. Reports each string as `file:line` with a rewrite or `cut`. |

## Requirements

`scripts/capture.mjs` and `ui-inspect`'s `scripts/inspect.mjs` need Node 22 or later and a Chromium-based browser. It uses `CHROME_PATH` when set, then an installed Chrome, Edge, or Chromium, then a Chromium that Playwright downloaded, from any of its cache folders (full build first, then the headless shell, newest first). It installs nothing. On a Linux host that blocks the Chromium sandbox, it retries once with `--no-sandbox`, as Playwright does there by default, and prints a note. If Chrome hangs at start, it kills that Chrome and retries once with a fresh profile.

## Upstream

`skills/design-spec/scripts/lib/cdp.mjs` is vendored byte-identical from [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) under the MIT License. `scripts/lib/LICENSE` holds the notice and `scripts/lib/UPSTREAM` records the pinned commit. `references/critique.md` is adapted from the same repo's critique reference.

`skills/design-audit/scripts/lint.mjs`, its rules, and `references/tells.md` are adapted from the same commit's linter, tells registry, and redesign skill; that folder's `UPSTREAM` lists what changed. `skills/ui-inspect/scripts/lib/probe.mjs` and `rules.mjs` are adapted from the same commit's inspector, under the same license; that folder's `UPSTREAM` lists what changed.

To re-sync, copy `skills/taste-skill/scripts/lib/cdp.mjs` from the new commit, carry any fixes in the inspector's probe and rules, and in the linter, its rules, and `tells.md`, over by hand, update the three `UPSTREAM` files, and run the tests.

## Tests

```bash
node --test 'plugins/design-toolkit/tests/*.test.mjs'
```

The capture suite renders a local fixture page and both templates in headless Chrome, and skips when no browser is installed. The inspect suite runs every rule against a broken fixture and a clean one, and also skips with no browser. The Playwright lookup suite builds fake browser caches in a temp folder and needs no browser.
