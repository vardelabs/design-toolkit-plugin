---
name: design-audit
description: Audits an existing site or app screen for generic, AI-made patterns and broken details, and reports what is wrong and how to fix it, in the order to fix it. It reads the source for tells (stock copy, emoji as UI, violet accents, gradient text, alert boxes, dead links), measures the rendered page with ui-inspect, captures it in light and dark, and leaves the visual critique to the reviewer, who judges the shots. It reports and never edits. Use before a redesign, when a page "looks AI-made" or generic, or on "audit this page", "what's wrong with this UI", "design review of the current screen". Do NOT use to review a change (that is design-spec) or to make the fixes.
---

# Design Audit

Before a redesign, the first need is a list of what is wrong and why, not a rewrite. This skill makes that list the way a designer would write it: each finding names the problem, where it shows, and the fix, ordered so the biggest problems come first.

`<skill>` below is this skill's folder. Keep working files in the session scratchpad, never in the repo.

## Pick the Mode

- **`app`** (default) for application screens. App screens may carry borders, overlay shadows, mono type for data, and their brand's own palette, so the marketing rules stay off.
- **`site`** for marketing pages, landing pages, and portfolios. It adds the house rules in `references/tells.md`.

Never audit an app screen in `site` mode: half its findings would be noise.

## Step 1: Gather the Evidence

```bash
node <skill>/scripts/audit.mjs --url http://localhost:5173/settings --src ./web/src --out <scratch>/audit
```

The script:

1. Captures the whole page (its full scroll width and height) at each `--viewport` (default `desktop` and `narrow`) in light and dark, with design-spec's `capture.mjs --full-page`. Content inside its own scrolling pane shows only where the pane rests.
2. Runs ui-inspect for the measured faults: overflow, clipped or covered text, contrast, fonts, sizes. An error the page logs while loading becomes a `page-error` finding.
3. Lints the source under each `--src` folder for tells, if you give one. It lists every file and line.
4. Puts each finding in the fix order and writes `audit.json` and `card.json` to `--out`. A measured finding names the shot for each viewport and theme it appeared at. A source finding names its files and lines: many source tells, such as a transition or a z-index, show in no shot. Both files record how many source files were scanned, and any skipped, so an empty scan never reads as a clean one.

Without `--out`, it writes to a fresh temp folder and prints the path, so an audit run from a repo never writes into it. It takes the same page options as ui-inspect: `--theme-attr`, `--cookies`, `--wait-for`, `--settle`, `--blur`, and `--ignore`. The linter also runs alone: `node <skill>/scripts/lint.mjs <dir> [--mode site] [--json]`.

### Edge Cases and Native Apps

The shots show the page with the data it had. Before you order the findings, check the screen against `references/impeccable/harden.md`: long and empty text, errors, slow and failed requests, translations and right-to-left text, and large numbers. List each gap the screen does not handle as a finding in the `detail` area. For a native iOS or Android app, read `references/impeccable/ios.md` or `android.md` instead of the web rules; the linter and ui-inspect do not apply there.

## Step 2: Judge the Shots

The script measures; it cannot see. Open every shot in `<out>/shots/` and run the passes in design-spec's `references/critique.md`, and the render-only tells at the end of `references/tells.md`. Judge the images, never the code.

Add each problem you see to the `findings` list in `card.json`, as `{ "level": "FAIL" | "WARN", "area": "...", "text": "...", "fix": "...", "where": "<shot or element>" }`. Name the problem precisely: "the supporting paragraph starts 40px left of the headline's edge", not "alignment is off".

## Step 3: Order and Present

Keep the list in the fix order, which `audit.mjs` already applies to its own findings. Insert yours where they belong:

1. **idea**: the copy says nothing specific, or placeholder text shipped. For a string that should not exist or says too much, use `clean-copy`'s ladder and name the rung it failed.
2. **hierarchy**: no single dominant element on a screen.
3. **composition**: edges, spacing, overflow, cut or covered content.
4. **type**: scale, measure, faces, sizes.
5. **imagery**: weak pictures, emoji as icons, broken images.
6. **colour**: contrast, accent discipline.
7. **detail**: states, focus, alerts, dead links, layers.
8. **motion**: last.

Then present it through design-spec. Fill the card with design-spec's `scripts/fill.mjs`, never by writing `.html` with an editor tool:

```bash
node <design-spec>/scripts/fill.mjs <design-spec>/assets/card.html <scratch>/audit/card.json <scratch>/audit/card.html
node <design-spec>/scripts/capture.mjs --url <scratch>/audit/card.html --out <scratch>/audit --name card --selector .card --margin 0 --card --theme light --viewport 1300x900
```

For a long audit, more than about fifteen findings or several screens, use the full sheet instead: put the findings in its `findings` field, the shots in `states`, and publish it as design-spec Step 4 describes.

## Rules

- **Report, never edit.** A redesign is a separate task.
- **Findings only.** This skill does not score pages.
- **No invented replacements.** Name the pattern and the procedure to fix it, never a stock font, colour, or component to swap in.
- **Synthetic data only** in any fixture you build to show a state.

## Files

| File | Purpose |
|---|---|
| `scripts/audit.mjs` | Captures, measures, and lints a page; orders the findings; writes `audit.json` and `card.json`. |
| `scripts/lint.mjs` | Source linter for tells, in `app` or `site` mode. |
| `scripts/lib/lint-rules.mjs` | The rules, each with its modes and fix-order area. |
| `scripts/lib/UPSTREAM` | The taste-skill commit these are adapted from, and what changed. |
| `references/tells.md` | Every rule, by mode and area, and the tells only a render shows. |
| `references/impeccable/harden.md` | Edge-case checklist: inputs, errors, i18n, text overflow, network. From Impeccable. |
| `references/impeccable/ios.md`, `android.md` | Platform notes for native app work. From Impeccable, distilled from ehmo's platform-design-skills. |
| `references/impeccable/UPSTREAM` | The Impeccable commit, which detector rules were ported, and which were skipped and why. |
