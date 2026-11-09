---
name: design-system-doc
description: Writes a repo-level DESIGN.md that every agent building UI in that repo reads first, so each session uses the same tokens, type scale, spacing, component rules, and banned patterns instead of choosing its own. It reads the repo's real tokens (CSS custom properties, Tailwind v4 theme blocks, token JSON) with a script that cites every value to file:line, marks each gap as an open question instead of inventing a value, writes rules that ui-inspect can measure, and adds a pointer line to the repo's CLAUDE.md. Use on "write a DESIGN.md", "document this repo's design system", "screens keep drifting", or before a run of UI work in a repo with no DESIGN.md. Do NOT use to design a new look (design-spec, site-taste), to audit a screen (design-audit), or to republish a Design System library (design-system-sync).
---

# Design System Doc

Each session that builds UI makes its own type, spacing, and colour choices again, so screens drift. One `DESIGN.md` per repo gives every session the same spec. The doc describes what the repo already is. It does not invent a new look.

## The Run

1. **Read the tokens with the script.** From the repo root:

   ```bash
   node <skill>/scripts/tokens.mjs .
   ```

   It prints the tables to stdout; read them from the command's output. The script reads the files the repo keeps: in a git repo, the tracked files and the untracked ones git does not ignore. It skips hidden folders, `node_modules`, and build output. It reads every custom property in the stylesheets, including Tailwind v4 `@theme` blocks, and the token JSON files `tokens.json`, `theme.json`, `design-tokens.json`, and `*.tokens.json`, each with an optional `.light` or `.dark` part in the name, such as `tokens.dark.json` or `dark.tokens.json`. Other JSON named like a token file, such as `tokens-dark.json`, is named for you to read by hand. A token file that names or holds a credential is not read, a custom property that does is left out, and the script names each such file. A file outside the repo, reached through a symbolic link, is never read. In a git repo where git does not run, the script stops instead of reading ignored files. It puts each token in a role (colour, type scale, font families, spacing, radius, shadows, other), with its light and dark values, and cites each value as `file:line`. A value is dark when its selector is a dark theme (`.dark`, `[data-theme="dark"]`, `prefers-color-scheme: dark`, Tailwind's `@variant dark`), it is the second half of `light-dark()`, or its file is named for dark (`dark.css`, `tokens.dark.json`). When a stylesheet's only theme selector is a light one, its default values are dark. Its last section is the open questions it found. `--json` prints the same result as data.

2. **Read the theme files the script cannot.** A `tailwind.config.*`, `theme.ts`, or `tokens.js` defines tokens in code, an indented `.sass` file has no braces to parse, Sass and Less variables (`$ink:`, `@ink:`) are not custom properties, and JSON in a `tokens/` folder under another name may not be tokens. The script lists each as an open question and does not guess. A token JSON file that does not parse is listed the same way. Read each one. Add each token it defines to the right table with its `file:line`, and remove that question.

3. **Read the components.** Open the shared components the screens use (button, input, card, dialog, menu, table, toast) and the global stylesheet. Write down only what the code does, with a `file:line` for each rule.

4. **Write `DESIGN.md` at the repo root** in the layout below. Copy the script's token tables as they are. A value that is not in a source file does not go in the doc. Where the repo has no answer, write the question under Open Questions.

5. **Add the pointer line** to the repo's `CLAUDE.md` (or `AGENTS.md` when that is the repo's instruction file), near the top:

   ```markdown
   Read `DESIGN.md` before you build or change UI. It holds this repo's tokens, type scale, component rules, and banned patterns.
   ```

6. **Check the doc.** Every value in it has a `file:line`, and that line holds that value. A DTCG dimension is the one exception: the script joins its `value` and `unit`, so `16px` cites the lines that hold `16` and `"px"`. Every rule that ui-inspect can measure names its rule id. No section holds a value that you chose.

## Layout

```markdown
# Design System: <repo>

## Tokens
(the script's tables: Colour roles, Type scale, Font families, Spacing, Radius, Shadows, Other tokens)

## Component Rules
- **Button:** <what the code does: fill, radius token, padding tokens, states> (src/ui/Button.tsx:12)
- ...

## Interaction and Focus
- Keyboard focus: <the focus style> (src/styles/base.css:40)
- Hover, pressed, disabled: <what changes, by token>

## Measured Rules
- Text contrast is at least 4.5:1, or 3:1 for large text. ui-inspect: `contrast`.
- ...

## Banned Patterns
- <a pattern the repo has removed or its instructions forbid, with where that is written>

## Reference Product
<only when the repo's instructions name one>

## Open Questions
- <each gap, as a question for the owner>
```

## Rules for Each Section

- **Tokens.** Name each colour by its role (background, text, muted text, accent, border, danger), as the token names do. The script already puts light and dark values from separate files in one table; keep it that way.
- **Component Rules.** One line per shared component. State the tokens it uses, not raw values. If two components do the same job in different ways (two button styles with no reason), write that as an open question. Do not pick one.
- **Measured Rules.** Write each rule as a threshold that ui-inspect measures, and name the rule id. Take the thresholds from `references/laws.md`. When the repo's own values are stricter (fewer type sizes, a set body size), use the repo's values. A rule that no tool can measure goes under Component Rules or Banned Patterns.
- **Banned Patterns.** List only what the repo's code, review history, or instruction files reject, with the place that says so. `references/laws.md` lists common generated-UI tells. Add one only when the repo shows it is unwanted, or put it under Open Questions for the owner.
- **Reference Product.** Include it only when the repo's `CLAUDE.md` or `AGENTS.md` names a product to match, as design-spec does. Quote that line. Otherwise leave the section out.
- **Open Questions.** Each item is a question the owner can answer in one line. Keep the script's questions you could not answer from the code.

## When the Doc Already Exists

Run the script again and compare its tables with the doc. Update values that moved, with their new `file:line`. Add new tokens. Ask about tokens the doc lists that the script no longer finds. Do not rewrite the sections a person wrote by hand.

## Files

| File | Use |
|---|---|
| `scripts/tokens.mjs` | Reads the tokens and prints the token tables and open questions, each value cited to `file:line`. |
| `scripts/lib/css.mjs` | Reads custom properties from CSS, SCSS, and Less, with comments, strings, `url()`, and Sass interpolation handled. |
| `scripts/lib/json.mjs` | Reads token JSON with the line of every value, including arrays and composite `$value` objects. |
| `references/laws.md` | Measurable thresholds for type, colour, and layout, each with the ui-inspect rule that checks it. |
