---
name: ui-inspect
description: Measures an app screen in a real headless browser and reports what a reviewer would only catch by eye if a screenshot happened to show it. It checks sideways overflow, text cut off by its box, text covered by another element, low contrast, a font that fell back, broken images, text under 12px, too many type sizes or typefaces, an overlong line, rows that scroll sideways, and icons that sit off the middle of the text beside them. It runs at the design-spec viewports in light and dark, and gives each FAIL and WARN a fix. Use before capturing review material for a UI change, after building or changing an app screen, or on "inspect this screen", "check the UI for overflow", "is anything clipped". Do NOT use for marketing-page art direction, or as a substitute for looking at the shots.
---

# UI Inspect

A screenshot shows a defect only if the defect is in frame, at that width, in that theme. This skill measures the rendered page instead, at every viewport and theme the review material uses, so overflow at 400px or unreadable text in dark mode is found before the shots go out.

`<skill>` below is this skill's folder. The script shares the design-spec page setup, so it sees the same page that `capture.mjs` shoots.

## Run It

```bash
node <skill>/scripts/inspect.mjs --url http://localhost:5173/composer
```

It needs Node 22 or later and finds a browser the same way `design-spec` does.

| Option | Default | Use |
|---|---|---|
| `--viewport` | `desktop` and `narrow` | `desktop` (1280x800), `narrow` (400x800), or `WIDTHxHEIGHT`. Repeat for several. |
| `--theme` | `light` and `dark` | Repeat to pick. |
| `--theme-attr` | none | Also set this attribute on `<html>` to `light` or `dark`, for apps whose theme attribute overrides `prefers-color-scheme`. |
| `--cookies` | none | Path to a JSON file holding an array of CDP cookie objects, for a page behind a sign-in. |
| `--wait-for` | none | A selector that must exist before the checks run. |
| `--settle` | `300` | Milliseconds to wait after load. |
| `--blur` | off | Blur the focused element first. |
| `--screens` | `4` | Window scroll positions read below the first screen, plus the page end, which is always read. Content inside its own scrolling pane is read only where the pane rests. |
| `--allow` | none | A rule id to skip. Repeat for several. |
| `--ignore` | none | A CSS selector whose text and images every check leaves out. Repeat for several. Use it for one false positive instead of turning a whole rule off with `--allow`. |
| `--config` | `.design-toolkit.json` in the working folder or the nearest folder above it | The repo's design config. See Repo Config. |
| `--json` | off | Print the report as JSON, the shape the design-spec sheet takes as `checks`. A rule that fires with different evidence at two viewports or themes is two findings. |

Use the same `--viewport`, `--theme-attr`, `--cookies`, `--wait-for`, `--settle`, and `--blur` as the capture, so each fixture state is checked as it is shot.

Each finding names its elements by a short class path, such as `"python" (div.code-head > span)`, and in JSON lists them under `selectors`, ready to pass to `--ignore`.

Exit 0 means no FAIL, exit 1 means at least one FAIL, and exit 2 means the run itself failed.

## The Rules

| Rule | Level | Finds |
|---|---|---|
| `overflow` | FAIL | The page scrolls sideways. Names the widest elements. |
| `clipped-text` | FAIL | Text cut off by a box that hides overflow, partly or by whole lines. An ellipsis excuses only its own box's side cut, and a line clamp only its own box's bottom cut. Text an ellipsis truncates ends at that box's edge, so no box outside it can cut it. A line is judged for a side cut only where it shows, so a long word on a clamp's hidden lines cuts nothing. Text inside a scrolling pane is cut only by the pane, which reveals it. |
| `covered-text` | FAIL | Text that another element paints over. An open menu, dialog, or tooltip is a state, not a defect, and is skipped, as is content under a fixed or sticky bar where scrolling reveals it (a sticky bar inside a scrolling pane is judged by that pane's scroll). A bar that hides text at load, or at the end of the page, is reported, and so is text under a pinned layer half the viewport tall or more, such as a side nav. A layer at near-zero opacity and a see-through fade cover nothing. |
| `contrast` | FAIL under 3:1, else WARN | Text below 4.5:1, or 3:1 for large text. A translucent background tint or text colour is laid over what is behind it first, so the ratio is the one a person sees. Disabled controls are exempt, as in WCAG. Text over an image is left to the eye. |
| `broken-image` | FAIL | An image that failed to load. |
| `font-count` | FAIL over 3, WARN at 3 | Typefaces in use. |
| `font-fallback` | WARN | A named typeface that renders as a fallback, measured in the page, so a face installed on the host counts as loaded. |
| `small-text` | WARN | Text under 12px. |
| `size-count` | WARN | More than nine font sizes. |
| `measure` | WARN | Running text over about 88 characters per line, at desktop widths. |
| `side-scroll` | WARN | A row that scrolls sideways with content past its edge. Tables, grids, tab lists, and elements marked `data-scroll-x` are skipped. |
| `optical-align` | FAIL at 0.75px or more | A small icon (`svg`, `img`, or `canvas`, 8 to 28px tall) in a flex or grid row whose ink sits off the middle of a capital letter beside it. A line box can be centred while its letters read high or low, so the letters are the test. Text and icons snap to the pixel grid, so the gap is read from the ink in a 2x screenshot of the icon and one flat-topped capital (such as H, E, or N), never from page geometry. Text with no such capital is not checked. A wrapper that holds only the icon, such as a grid cell or a button, is walked up to the row it sits in, and an absolutely positioned icon is skipped. A pair with another layer over it, such as an open dialog's scrim, is skipped too: the screenshot there shows the layer, not the ink. The message gives the signed gap: low means the icon sits below the letter's middle. |

## Repo Config

A repo keeps its design exceptions in `.design-toolkit.json` at its root. Run ui-inspect from inside the repo, or pass `--config`. The report names the config it read.

```json
{
  "optical-align": {
    "exceptions": [{ "selector": ".group-toggle .caret", "centre": "x-height" }]
  }
}
```

An exception applies to an icon that matches `selector` or sits inside an element that does. `centre` is the height that icon centres on: `cap-height` (the default for every icon) or `x-height`, for a mark that reads with the lowercase letters, such as a fold caret on a group heading. An `x-height` icon is measured against a flat lowercase letter, such as n, r, or x.

## Acting on the Report

- **Fix every FAIL before you capture review material.** If a FAIL is right on purpose (a fixture that shows a broken image), or a measurement is wrong about one element, pass `--ignore <selector>` for that element, or `--allow <rule>` only when the whole rule does not apply. Say why in the material.
- **Fix a WARN, or keep it with a reason.** On a full sheet, add each `--json` report to `checks` with a `screen` label naming the screen and state, and add a `reason` to each finding you keep.
- **A clean report is not a review.** It checks geometry and colour. It does not judge hierarchy, spacing, or whether the screen does its job. Look at the shots.

## Files

| File | Purpose |
|---|---|
| `scripts/inspect.mjs` | Runs the checks at each viewport and theme, merges the findings, prints text or JSON. |
| `scripts/lib/probe.mjs` | Runs in the page: type, contrast, overflow, and the per-scroll covered and clipped text checks. |
| `scripts/lib/align.mjs` | The optical-align check: pairs each icon with a letter in the page, then reads both from a screenshot. |
| `scripts/lib/rules.mjs` | Turns the measurements into FAIL and WARN findings with fixes. |
| `scripts/lib/UPSTREAM` | The taste-skill commit these files are adapted from, and what changed. |
