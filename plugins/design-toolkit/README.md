# Design Toolkit

**Version:** 0.15.1 | **Status:** Beta | **Author:** Varde Labs

Design review tooling for UI work: `design-spec` makes the review material, `ui-inspect` measures the screen first, `design-audit` lists what is generic or broken on an existing screen, `clean-copy` cuts interface copy that should not exist, `design-system-sync` republishes a repo's Design System library after a merge, `site-taste` gives marketing pages an art direction, and `design-system-doc` writes a repo's `DESIGN.md` from its real tokens.

## Install

See the repository README.

## Skills

| Skill | Fires on | Purpose |
|---|---|---|
| `design-spec` | Sending screenshots of a UI change, a reviewer asking to see a UI change or its states, a PR that changes a screen | Makes a quick card (one composed image) or a full sheet (a claude.ai Artifact republished each round). Starts from a state inventory checked against the server contract, captures headless at fixed viewports, 2x, light and dark, and checks the material before it goes out. |
| `ui-inspect` | Before capturing review material, after changing an app screen, "is anything clipped" | Measures the rendered screen at the design-spec viewports in light and dark: overflow, clipped and covered text, contrast, font fallback, broken images, small text, type sizes and faces, line length, sideways rows, icons off the middle of their text, and icon-only buttons off the middle of the controls beside them, with per-repo exceptions in `.design-toolkit.json`. Each FAIL and WARN carries a fix. |
| `design-audit` | Before a redesign, a page that "looks AI-made", "audit this page" | Lints the source for generated-page tells (app or site rule set), measures the page with ui-inspect, captures it in light and dark, and orders every finding by the fix order with the shot that shows it. Presents through a design-spec card. Reports, never edits. |
| `clean-copy` | Writing or reviewing any user-facing string, "clean up the copy" | Cuts interface copy that should not exist (restated labels, pre-empted worries, scar tissue from fixed bugs) by a four-rung ladder, keeps legal, accessibility and safety text, and sets the shape of an error message. Reports each string as `file:line` with a rewrite or `cut`. |
| `design-system-sync` | The merge hook's notice, "sync the design system", "the library is stale" | Rebuilds a repo's private Design System library from its default branch in a temporary detached worktree, republishes it with the Artifact tool, and reports the commit and the cards that changed. The repo declares the artifact, source paths, and commands in `.design-toolkit.json`. |
| `site-taste` | Building, redesigning, or restyling a landing page, marketing site, portfolio, product page, or one-pager, including one that "looks AI-made" and should be rebuilt; a report-only ask goes to `design-audit` | Art direction for marketing pages, vendored from taste-skill v2. Deals a researched direction from a library of studied sites, writes the copy deck before markup, gates the page with its own linter and real-browser inspector, and runs a screenshot critique loop. |
| `design-system-doc` | "Write a DESIGN.md", "document this repo's design system", screens that keep drifting | Writes a repo-level `DESIGN.md` that every UI session reads first: tokens with light and dark values, type scale, spacing, component rules, measured rules named by their ui-inspect rule, and banned patterns. A script reads the repo's custom properties and token JSON and cites each value to `file:line`; each gap becomes an open question, never an invented value. Adds a pointer line to the repo's `CLAUDE.md`. |

### Routing

- **Building goes to `site-taste`; reporting goes to `design-audit`.** "This landing page looks AI-made" means a rebuild when the ask is to fix it, and an audit when the ask is to say what is wrong. design-audit reports and never edits. site-taste drives a build.
- **App screens go to `design-spec` and `ui-inspect`.** Dashboards, settings, forms, and other product UI are not marketing pages. `site-taste` states this in its description and does not fire on them.
- **CSS technique goes to `css-toolkit:good-css`.** good-css owns how to write the CSS: layout methods, cascade, tokens in code. `site-taste` owns art direction: what the page says, how it is composed, its type, palette, and pictures.
- **House rules and brand devices.** The `site-taste` house rules ban eyebrow labels, monospace, numbered lists of sections, thin rules, gradients, resting shadows, and some palettes. When a brand's own guide uses one of these on purpose, pass that rule to the inspector with `--allow <rule>` and say why in the review.
- **`scripts/assets.mjs` calls external APIs.** It searches open collections (Openverse, Wikimedia Commons, museum and archive APIs) and downloads the pictures it picks. Run it only where the host may make those calls.

## Hooks

`design-system-sync-on-merge` runs after `gh pr merge`. When the PR merged into the default branch and touched the repo's declared source paths, it tells the session to run `design-system-sync` in the same turn. It stays silent otherwise, never publishes, and always exits 0. A repo with no `design-system-sync` block in `.design-toolkit.json` never hears from it. A merge outside a Claude session fires no hook; run the skill by hand, or let the next merge's run catch up.

## Requirements

`scripts/capture.mjs` and `ui-inspect`'s `scripts/inspect.mjs` need Node 22 or later and a Chromium-based browser. It uses `CHROME_PATH` when set, then an installed Chrome, Edge, or Chromium, then a Chromium that Playwright downloaded, from any of its cache folders (full build first, then the headless shell, newest first). It installs nothing. On a Linux host that blocks the Chromium sandbox, it retries once with `--no-sandbox`, as Playwright does there by default, and prints a note. If Chrome hangs at start, it kills that Chrome and retries once with a fresh profile.

`site-taste`'s `scripts/inspect.mjs` is upstream's and has none of these fallbacks. It uses `CHROME_PATH` or an installed Chrome, Edge, or Chromium. On a host with no installed browser, set `CHROME_PATH` to a Playwright Chromium. On a host that blocks the Chromium sandbox, point `CHROME_PATH` at a wrapper that adds `--no-sandbox`.

## Upstream

`skills/design-spec/scripts/lib/cdp.mjs` is vendored byte-identical from [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) under the MIT License. `scripts/lib/LICENSE` holds the notice and `scripts/lib/UPSTREAM` records the pinned commit. `references/critique.md` is adapted from the same repo's critique reference.

`skills/design-audit/scripts/lint.mjs`, its rules, and `references/tells.md` are adapted from the same commit's linter, tells registry, and redesign skill; that folder's `UPSTREAM` lists what changed. `skills/ui-inspect/scripts/lib/probe.mjs` and `rules.mjs` are adapted from the same commit's inspector, under the same license; that folder's `UPSTREAM` lists what changed.

`skills/site-taste/` is vendored from the same repo and commit under the same license: `SKILL.md`, `references/`, `library/`, `scripts/`, and `assets/base.css` and `assets/base.js`, byte-identical except the `SKILL.md` frontmatter. Its `LICENSE` holds the notice and its `UPSTREAM` lists what was taken, changed, and left out. Its `scripts/lib/cdp.mjs` is the same file as design-spec's copy, and a test fails when the two differ.

`skills/design-system-doc/references/laws.md` is adapted from the same commit's type, colour, and layout references and its `stitch-skill`; that folder's `UPSTREAM` lists what changed.

`skills/design-audit` also adapts parts of [pbakaus/impeccable](https://github.com/pbakaus/impeccable) under the Apache License 2.0: fourteen detector rules, rewritten as source patterns in `scripts/lib/lint-rules.mjs`, and the edge-case and platform references in `references/impeccable/`. Its iOS and Android notes derive from ehmo's MIT-licensed `platform-design-skills`. `NOTICE.md` holds both credits, and `references/impeccable/UPSTREAM` lists the rules ported, skipped as duplicates, and left for a rendered-page check.

To re-sync, copy the files `skills/site-taste/UPSTREAM` lists from the new commit's `skills/taste-skill/` over `skills/site-taste/`, keeping its frontmatter, and copy `scripts/lib/cdp.mjs` to design-spec too. Carry any fixes in the inspector's probe and rules, and in the linter, its rules, and `tells.md`, over to ui-inspect and design-audit by hand, and any fixes in the type, colour, and layout references and `stitch-skill` over to design-system-doc's `laws.md`. Update the five `UPSTREAM` files, and run the tests.

## Tests

```bash
node --test 'plugins/design-toolkit/tests/*.test.mjs'
```

The capture suite renders a local fixture page and both templates in headless Chrome, and skips when no browser is installed. The inspect suite runs every rule against a broken fixture and a clean one, and also skips with no browser. The site-taste suite checks that its `cdp.mjs` matches design-spec's, and lints and inspects a synthetic landing page, which must pass with 0 FAIL; the inspect step skips with no browser. The design-system-doc suite runs the token script on a fixture repo and checks that every cited value is on its cited line. The Playwright lookup suite builds fake browser caches in a temp folder and needs no browser.
