---
name: design-spec
description: Makes the review material for a UI change, the way a product design team would. A quick card (one composed image, inline in chat) for a small change, or a full sheet (a private claude.ai Artifact, republished to one URL each round) for a build with states the reviewer cannot reach in the dev preview. Starts from a state inventory checked against the code and the server contract, captures with a headless script at fixed viewports, 2x, light and dark, and checks the material before it goes out. Use when you are about to send screenshots of a UI change, when a reviewer asks to see a UI change or its states, when a PR changes what a screen looks like or does, or on "show me the UI", "send screenshots", "design review", "before and after". Do NOT use for marketing-page art direction or for a non-visual change.
---

**Version:** 0.3.0 -- see git history for changes.

# Design Spec

A reviewer judges a UI change only from what you send. Loose, unlabeled, oddly cropped screenshots make the reviewer ask for each state, and a stale frame shows something that is not on the screen. This skill makes review material that answers those questions before they are asked.

`<skill>` below is this skill's folder. Keep working files (shots, filled templates) in the session scratchpad, never in the repo.

## Pick the Format

Make the state inventory (Step 1) first, then pick:

| Format | Use when | Delivery |
|---|---|---|
| **Quick card** | The reviewer can reach every state in the inventory in the dev preview. | One PNG at 2x, inline in chat, with every state in it. |
| **Full sheet** | The inventory holds states the reviewer cannot reach in the dev preview: error paths, mocked data, large counts, long text, narrow windows. | A private claude.ai Artifact, republished to the same URL each round. |

Even a one-screen tweak gets a quick card, not a bare screenshot.

## Step 1: Inventory the States

List every state before you capture anything. Read two sources:

1. **The code of the changed screen.** Each branch that changes what renders is a state: empty, loading, error, one item, many items, long text, disabled, focused, and each width the layout changes at.
2. **The server contract.** For each state, find where the server produces the data that drives it. Cite the file and line.

A state the server cannot produce must not appear. Remove it from the inventory, and flag the client code that renders it as dead code in the PR.

> **Example (synthetic).** A filter menu shows status values. A mocked preview showed new values appear after the user adds a project type. The server builds the list only from the status field's allowed values, so adding a project type never changes it. That state is impossible: drop it, and flag the mock path as dead code.

Write the inventory as a table and keep it for Step 5:

| Screen | State | Source | Server can produce it? (cite) |
|---|---|---|---|
| Composer | Upload failed | Fixture: upload endpoint returns 413 | Yes, `api/upload.py:88` |

Label each state **Real server** or **Fixture: <what>**. Fixtures use synthetic data only; never name a real firm, client, or person. To drive a page into a fixture state, especially behind a sign-in, follow `references/fixtures.md`.

## Step 2: Capture

First run `design-toolkit:ui-inspect` on each screen and fixture state, with the same `--viewport`, `--theme-attr`, `--cookies`, `--wait-for`, `--settle`, and `--blur` you will capture with, from inside the app's repo so it reads the repo's `.design-toolkit.json`. Fix every FAIL before you capture; a shot of a broken screen goes back for another round. Keep each `--json` report for the full sheet.

Use `scripts/capture.mjs`. It drives Chrome headless (Node 22+, no npm install), so every shot is a fresh paint of the final layout. It looks for `CHROME_PATH`, then an installed Chrome, Edge, or Chromium, then a Chromium that Playwright downloaded (`PLAYWRIGHT_BROWSERS_PATH`, `~/.cache/ms-playwright`, `~/Library/Caches/ms-playwright`, or `%LOCALAPPDATA%\ms-playwright`).

```bash
node <skill>/scripts/capture.mjs --url http://localhost:5173/composer --out <scratch>/shots --name composer-after --selector '[data-testid=composer]' --viewport desktop --viewport narrow
```

| Option | Default | Use |
|---|---|---|
| `--viewport` | `desktop` | `desktop` (1280x800), `narrow` (400x800), or `WIDTHxHEIGHT`. Repeat for several. |
| `--theme` | `light` and `dark` | Repeat to pick. Each theme is a separate shot. |
| `--selector` | whole viewport | Crop to this element plus `--margin` (default 24px). Repeat it to crop to the union of several elements, for example a dialog and a menu that opens past its edge. |
| `--theme-attr` | none | Also set this attribute on `<html>` to `light` or `dark`, for apps whose theme attribute overrides `prefers-color-scheme`. |
| `--cookies` | none | Path to a JSON file holding an array of CDP cookie objects, for a page behind a sign-in. |
| `--wait-for` | none | A selector that must exist before the shot. |
| `--settle` | `300` | Milliseconds to wait after load. |
| `--blur` | off | Blur the focused element before the shot. |
| `--full-page` | off | With no `--selector`, capture the document's whole scroll width and height instead of the first screen. |

It writes `<name>-<viewport>-<theme>.png` at 2x and prints JSON per shot. Treat any `brokenImages` or `pageErrors` entry as a failed capture.

The capture rules:

- **Fixed viewports.** Before and after use the same viewport and the same crop.
- **Both themes** for every state. Check that the dark shot is really dark. If it is not, the app sets its theme another way: use `--theme-attr`.
- **2x, cropped to the component with margin.** Never upscale a shot.
- **Before comes from `main`.** Add a worktree of `origin/main`, run its dev server on another port, and capture it with the same arguments and `--name <screen>-before`.
- **Animations are frozen** and reduced motion is on, so a shot never catches a transition halfway.
- **No focus ring a person never sees.** A state that a script opened (a dialog, a menu) keeps focus where the script put it, and the shot draws its ring. Pass `--blur`, unless the state you show is the focus state itself.
- **Never send a stale frame.** If you must use the Claude desktop browser pane (for example, no cookies for a signed-in page), make the pane visible and take a fresh screenshot after it repaints. A hidden pane does not repaint, so a shot taken while it is hidden can show an old or blurred frame.
- **Sandbox blocked.** On a Linux host that blocks unprivileged user namespaces (Ubuntu 23.10 and later), Chromium has no usable sandbox. `capture.mjs` then retries once with `--no-sandbox` and prints a note. Capture only pages you trust: your own dev server, `main`, and the templates.
- **Zoom crops for each changed element.** Crop the element itself with `--selector` and a small `--margin` (8 to 14), before and after, both themes. These show the change large; the whole-screen pairs are context.
- **`--selector` takes the first match.** A class that a parent row also carries matches the parent. Narrow it with `:has()` or a more specific path.
- **An element inside its own scrolling pane, below the fold,** can crop to the wrong region. Use a taller `--viewport`, such as `1280x1600`.
- **No browser at all.** If `capture.mjs` finds no browser, not even a Playwright Chromium, and the session has no browser pane, say so to the reviewer and stop. Do not send loose screenshots from another tool in place of the card or sheet.

## Never Open a Draft in the Preview Pane

The reviewer reads review pages where they chose to (Step 4). On the Claude desktop app, writing an `.html` file with the Write tool opens it in the app's Browser preview pane. That pane is not the artifact pane, which a publish opens and Step 4 closes. The rule covers every page you send, a template or a page you built yourself. So:

- Fill a template only with `scripts/fill.mjs`, run through the shell. Build a custom page through the shell too (a heredoc or a script), never with the Write tool. Write the data as a `.json` file, which is safe, and never create or rewrite the `.html` with the Write tool.
- Change a filled page by editing its `.json` and running `fill.mjs` again.
- Check renders headless with `capture.mjs`. Never look at the sheet in the preview pane.

```bash
node <skill>/scripts/fill.mjs <skill>/assets/sheet.html <scratch>/sheet.json <scratch>/sheet.html --title "Composer Attach Button"
```

## Write for a Designer

The summary, titles, and look-for lines are read by a designer or a product person, not by the person who reviews the code. Write what the person using the app sees and does, in the app's own words: its button labels, headings, and menu names.

Keep the summary to three lines or fewer at the sheet's full width, and on the card. It runs the full width of the page, so three lines hold about 60 words. When it runs longer, the rendered card or sheet says so in red under it.

Leave out what needs the code to make sense:

- File and line references.
- Internal step, component, or function names.
- Engineering terms, such as "native dropdown", "picklist", or "modal state".
- Review bookkeeping, such as a state removed as impossible.

Those belong in the PR body. The full sheet keeps its own section for impossible states.

> **Example (synthetic).** Bad: "The dry run step names the project types the admin left out, with a one-tap add for each. The status values step uses the app's own menu in place of native dropdowns. One state was removed as impossible: a jump back to status values after adding a type (`sync.py:180`)."
>
> Good: "After the admin connects the project tracker, the app can check every field to learn which ones hold due dates and owners. These shots show the Check Fields button, what the admin sees while the check runs, the result, and the new Field Check row in Settings where they can run it again."

## Step 3: Build the Quick Card

The quick card is one image. Every state goes in it, each with a title and a look-for line, under the summary. Never send the shots as separate files.

1. Write the card data as `<scratch>/card.json`, beside `shots/`.
2. Fill in `ref` (the PR), `status`, `title`, a plain `summary` of one to three sentences (see Write for a Designer), `viewport`, `source` (the before and after commits), `beforeLabel` and `afterLabel` (the column names, such as `Before (main)` and `After (feat/attach)`), and `captured`. Then add the shots:
   - `screens`: one entry per changed screen, with `before` and `after` in both themes. Leave `before` out for a new screen.
   - `states`: every other state from the inventory, as `{ "label", "lookFor", "light", "dark" }`. They render as a grid, `columns` across (default 2; use 3 for small crops, 1 for wide screens).

   Every screen and state has a `lookFor` line that names the element and the change, for example "The paperclip button left of Send, and the 1 badge on it after a file is added." Then run `fill.mjs` with `assets/card.html` to make `<scratch>/card.html`.
3. Render it:

   ```bash
   node <skill>/scripts/capture.mjs --url <scratch>/card.html --out <scratch> --name card --selector .card --margin 0 --theme light --viewport 1300x900
   ```

4. Send `card-1300x900-light.png`, and only that file, inline (`SendUserFile` on the desktop, or an attachment in a chat channel). It is 2x: 2400 pixels wide.

## Step 4: Build the Full Sheet

1. Write the sheet data as `<scratch>/sheet.json`, beside `shots/`, and run `fill.mjs` with `assets/sheet.html` and a `--title` of two to four words. The template has no doctype, `html`, `head`, or `body`, because the Artifact tool adds its own; do not add them.
2. The data's fields:
   - `ref`, `status`, `round`, `title`, `summary`, `viewport`, `source`, `captured`. Write the `summary` and every `lookFor` line as Write for a Designer says.
   - `beforeLabel` and `afterLabel`: the column names for before and after. Name the real commits or branches, such as `Before (main @ 1a2b3c4)`; a sheet made after merge must not say "this branch".
   - `changes`: what changed since the last round. Round 1 leaves it empty.
   - `colors`: one row per changed colour per theme: `token`, `where` (the places it is used), `theme`, `surface` (what it sits on), `target` (the ratio it must meet: 4.5 for text, 3 for large text and icons, or the target the repo sets), and `before` and `after`, each with a `text` colour, an opaque `ground` colour, and an optional see-through `tint` laid over the ground. The sheet computes every ratio from these values. Never type a ratio, and never read one off a screenshot. Leave it empty when no colour changed.
   - `zooms`: one entry per changed element: `label`, `lookFor`, and `before` and `after` crops in both themes. They show every captured pixel, so the change reads large.
   - `beforeAfter`: each changed screen, before from `main` and after from the branch, each with a `lookFor` line. With zooms present, these are the context.
   - `interactive`: one entry per element whose states need a pointer or the keyboard: hover, press, focus, a drag target, a menu that opens. See Interactive States below. Leave it empty for a change a screenshot shows in full.
   - `states`: every state from the inventory, by screen, with its `source` label.
   - `checks`: one entry per `ui-inspect --json` report, each with a `screen` label added (the screen and state it checked), and a `reason` on each finding you keep on purpose. Set it to `null` or `[]` if ui-inspect did not run, so the sheet claims no check.
   - `removed`: each inventoried state removed as impossible, with `state`, `reason`, and the server `citation`. It renders on every round.
   - `parity`: one line per change, `matches` or `differs` with the reason. Fill it **only when the repo's instructions name a reference product to match**; otherwise leave it empty and the section does not render.
   - `options`: the options considered, one marked `recommended`, **only when there was a real choice**. Otherwise leave it empty.
   - `interactions`: keyboard, focus, and what each click does.
   - `notInScope`: what this change leaves out on purpose, and why.
   - `questions`: the open questions for the reviewer.
   - `findings`: a list of `{ level, area, text, fix, where }`, rendered as Findings, in the Order to Fix Them. design-audit fills it; a change review leaves it empty. The quick card takes the same field.

   Every list may be empty. Its section then does not render, so a sheet holds only what it has.
3. Publish it with the Artifact tool (`icon`: `layout` on the first publish), with every shot under `files` (for example `{"shots/composer-after-desktop-light.png": "<scratch>/shots/composer-after-desktop-light.png"}`).
4. Each later round, republish **the same file path** so the URL stays the same. Put the URL in the PR body the first time.
5. Right after each publish, close the app's artifact pane: call `mcp__ccd_view__close_pane` with pane `artifact`. On the Claude desktop app a publish opens that pane by itself, even when no editor tool touched the `.html`. Skip this step when the open mode is `app-pane`, or where the session has no such tool or is not on screen.
6. Open the sheet the way the reviewer set: run `<skill>/scripts/open-sheet.sh <artifact URL>`. It prints the link, and the link always goes in the reply, whatever the mode. The mode comes from `--mode`, else the `DESIGN_SPEC_OPEN` environment variable, else `auto`:

   | Mode | Opens |
   |---|---|
   | `auto` (default) | `browser-background`. |
   | `browser-background` | The default browser, left behind the app in use (`open -g`). |
   | `browser-foreground` | The default browser, brought to the front. |
   | `app-pane` | Nothing: the desktop app's artifact pane shows it, so step 5 leaves the pane open. |
   | `none` | Nothing: the link in the reply is enough. |

   Off macOS, every mode only prints the link. Set the default for a machine in the session environment, for example `"env": {"DESIGN_SPEC_OPEN": "browser-foreground"}` in Claude Code's `settings.json`.

### Interactive States

A shot cannot show what happens under the pointer. For such a change, rebuild the element in HTML and CSS over a real 2x shot of its screen. The sheet then shows it twice: live, so the reviewer can hover, press, and tab to it in both themes, and frozen once per state, side by side, so the states compare at a glance and `capture.mjs` can shoot them.

Each `interactive` entry:

```json
{
  "label": "Caption buttons",
  "lookFor": "Close turns red with a white glyph on hover.",
  "standIn": "What on the page is a stand-in, and what the real platform adds that a page cannot show.",
  "width": 720, "height": 64,
  "background": { "light": "shots/bar-bare-light.png", "dark": "shots/bar-bare-dark.png" },
  "overlay": { "html": "<div class=\"caption\">...</div>", "css": ".cap:hover, .cap.is-hover { ... }" },
  "states": [{ "name": "Hover Close", "target": ".close", "mode": "hover" }]
}
```

- **Background.** Capture the screen without the element, or with it at rest, at `width` by `height` CSS pixels (2x on disk), in both themes.
- **Overlay.** Place it absolutely within the stage. Use the product's own markup and CSS where they can run in a page, and a stand-in only where they cannot, such as controls the operating system draws. The stage carries `light` or `dark` as a class for theme rules. The CSS is scoped to its entry.
- **States.** Write each state rule twice in one selector: the real pseudo-class and its class, as `:hover, .is-hover`, `:active, .is-press`, and `:focus-visible, .is-focus`. A frozen copy adds the class to every element its `target` matches, and it is inert: it takes neither the pointer nor keyboard focus, so only the live row reacts.
- **Say what is not real.** Fill `standIn` every time. The reviewer must know which pixels are the product and which the page drew.
- The overlay HTML and CSS go in the `.json` data like every other field, through `fill.mjs`. Never write the filled `.html` with the Write tool.

## Step 5: Check Before Sending

Read `references/critique.md` and check the rendered card or sheet against it. Judge the images, not the code. Then do the completeness check:

- Count the states in the inventory. Every one is in the material, or it was removed as impossible with its server citation.
- Every image has a screen, state, and theme label.
- A quick card is one image that holds every state. No state is sent as a separate file.
- Every before and after pair and every zoom says what to look for, naming the element and the change, and says so when a part is meant to stay the same.
- Every changed colour is a row in `colors`, with its target.
- Run `ui-inspect` on the filled sheet itself with `--ignore .sample --ignore .stage`. The colour samples show failing colours on purpose, and an interactive stage is the product's own screen, checked on its own.
- The summary fits three lines: no red "runs N lines" note under it on the card or the desktop-width sheet.
- Every frozen interactive state renders with no red "matched nothing" line, and the stand-in note says what the page cannot show.
- Nothing claims a check that did not run. If a state could only be captured in the browser pane, or a fixture stood in for the server, the material says so.

Fix what fails, re-render, and check again. Then send it.

## Files

| File | Purpose |
|---|---|
| `scripts/capture.mjs` | Headless capture: fixed viewports, 2x, both themes, crop, broken-image and page-error report. |
| `scripts/fill.mjs` | Fills a template's JSON block from a data file through the shell, so no editor tool writes the `.html`. |
| `scripts/open-sheet.sh` | Opens a published sheet by the reviewer's chosen mode, and prints its link. |
| `scripts/lib/page.mjs` | Viewports, themes, and page setup, shared with `ui-inspect` so both see the same page. |
| `scripts/lib/launch-browser.mjs` | Picks the browser, retries once with `--no-sandbox` where a Linux host blocks the sandbox, and retries once with a fresh profile when Chrome hangs at start. |
| `scripts/lib/playwright-chromium.mjs` | Finds a Chromium that Playwright downloaded, for hosts with no installed Chrome. |
| `scripts/lib/cdp.mjs` | Zero-dependency Chrome DevTools Protocol client, vendored from taste-skill (MIT); see `scripts/lib/UPSTREAM`. |
| `assets/card.html` | Quick card template, data-driven from its JSON block. |
| `assets/sheet.html` | Full sheet template for the Artifact, light and dark, phone-width safe. |
| `references/critique.md` | How to check the material before it goes out, and the round log. |
| `references/fixtures.md` | How to drive a page into a fixture state, including behind a sign-in. |
