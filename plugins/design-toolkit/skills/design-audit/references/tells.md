# Tells the Linter Finds

Adapted from taste-skill's dated registry of generated-page tells and its redesign audit (MIT, see `../scripts/lib/LICENSE` and `UPSTREAM`). The rules from `side-tab` down are ported from Impeccable's detector (Apache-2.0, see `impeccable/`).

A tell is a device that makes a page read as generated. Most began as good ideas on good sites. They became tells by being produced by default, everywhere, without a reason. So a finding names the pattern and a procedure, never a replacement font, colour, or component: every published "use this instead" list has become the next wave of tells.

## Modes

- **`app`** (default) is for application screens. An app may carry borders, shadows on overlays, mono type for data, and whatever palette its brand chose, so those marketing rules are off.
- **`site`** is for marketing pages and adds the house rules: no hairlines, outlined boxes, resting shadows, index numbering, eyebrows, mono labels, gradient fills, or default typefaces.

Mark a line kept on purpose with a `design-audit-ignore` comment. In `.js`, `.jsx`, `.ts`, and `.tsx` files, the `copy` rule reads only string literals and JSX text, so an identifier such as `robust` is not copy. A gradient on a loading label (a selector naming shimmer, skeleton, loading, thinking, or pending) is a progress signal, not a tell, and is not flagged.

## Rules

| Rule | Level | Modes | Area | Finds |
|---|---|---|---|---|
| `mono` | FAIL | site | type | Monospace type outside code. |
| `gradient` | FAIL | site | colour | Gradient fill. Use a flat colour or a real image; a neutral scrim over a photo is the one exception. |
| `gradient-text` | FAIL | app, site | colour | Gradient or clipped text. Use a solid colour. |
| `shadow` | FAIL | site | detail | Shadow on an element at rest. Only real overlays (menu, dialog, sticky bar) carry one. |
| `numbering` | FAIL | site | hierarchy | Decorative index numbering (01, 02, 03). |
| `eyebrow` | FAIL | site | hierarchy | Eyebrow or kicker label above a heading. |
| `micro-label` | FAIL | app, site | type | Tiny uppercase letter-spaced label. |
| `purple` | FAIL | app, site | colour | Indigo or violet: the generated-page accent. |
| `claude-palette` | FAIL | site | colour | Assistant-brand cream or terracotta colour. |
| `emoji` | FAIL | app, site | imagery | Emoji used as UI. Use words or a real icon. |
| `lorem` | FAIL | app, site | idea | Placeholder copy shipped. |
| `hairline` | FAIL | site | detail | Thin rule or divider line. Separate with space, tone, or scale. |
| `outlined-box` | WARN | site | detail | A 1px outlined box. Prefer a filled surface or no box. |
| `glass` | WARN | app, site | detail | Backdrop blur. One sticky bar at most; glass cards are a tell. |
| `copy` | WARN | app, site | idea | Stock marketing phrase. Say the specific thing it does. |
| `cta-copy` | WARN | app, site | idea | Generic button label. Name the action or the thing. |
| `oops-copy` | WARN | app | idea | Cute error copy. Say what failed and what to do. |
| `default-font` | WARN | site | type | A default typeface. |
| `alert` | WARN | app | detail | window.alert for feedback. Show the message inline, next to what it is about. |
| `z-index` | WARN | app | detail | Arbitrary z-index. Use a named layer scale. |
| `dead-link` | WARN | app | detail | A link to "#". Point it somewhere real, or make it a button. |
| `transition-all` | WARN | app, site | motion | transition: all. Name the properties (transform, opacity). |
| `ease-in` | WARN | app, site | motion | ease-in on UI feels sluggish. Use an ease-out for enters and exits. |
| `scale-zero` | WARN | app, site | motion | Entering from scale(0). Start near 0.95 with opacity 0. |
| `h-screen` | WARN | app, site | composition | 100vh jumps on mobile. Use 100svh or 100dvh. |
| `bounce` | WARN | app, site | motion | Looping attention animation. |
| `side-tab` | WARN | app, site | detail | A thick accent stripe on one side of a card. Remove it, or mark the state some other way. |
| `border-accent-on-rounded` | WARN | app, site | detail | A thick accent band on a rounded card; the band fights the corners. Drop the band or the radius. |
| `bounce-easing` | WARN | app, site | motion | Bounce or elastic motion, or an easing curve that overshoots. Real objects slow down smoothly; use an ease-out. |
| `dark-glow` | WARN | app | detail | A coloured glow around an element. Use contrast or a surface step for emphasis. |
| `radial-halo` | WARN | app | colour | A coloured radial wash fading to transparent behind content. Use a flat surface. |
| `marquee` | WARN | app, site | motion | Content that scrolls by itself. Show it still, or let the user scroll it. |
| `blinking-cursor` | WARN | app, site | motion | A blinking cursor that imitates typing where no input exists. Show the text. |
| `extreme-negative-tracking` | WARN | app, site | type | Letter-spacing tighter than -0.09em; the letters touch. Tighten display type by eye, not past their shapes. |
| `justified-text` | WARN | app, site | type | Justified text. Without hyphenation it opens rivers of space; set it flush left. |
| `repeating-stripes-gradient` | WARN | app | detail | Stripes from a repeating gradient as surface decoration. Leave the surface plain. |
| `organic-clip-path` | WARN | app, site | imagery | A clip-path that draws a blob, torn edge, or silhouette. Use a real image or a plain shape. |
| `hard-offset-shadow` | WARN | app | detail | A hard offset shadow with no blur. Keep it only if the design means a neobrutalist look. |
| `theater-slop-phrase` | WARN | app, site | idea | Calling something "theater". Say plainly what it does or does not do. |

Impeccable checks these in a rendered page; here they read one source line, so each is a WARN to confirm in the shots. `dark-glow`, `radial-halo`, `repeating-stripes-gradient`, and `hard-offset-shadow` run in app mode only, because site mode already bans every shadow and gradient. `radial-halo` also covers Impeccable's `radial-spotlight-glow`: a source line cannot tell an accent wash from any other coloured one. The `theater-slop-phrase` rule reads copy as `copy` does: strings and JSX text in script, and never a comment.

## What a Render Shows Instead

Some tells only a person sees in the shots. Check these during the critique (design-spec `references/critique.md`):

- Three identical feature cards, each with an icon in a rounded square.
- A centred headline, a subtitle, two buttons, and a screenshot below.
- One word of the headline set in italic, colour, or underline.
- A fake dashboard built from grey bars and donut charts.
- The same layout family in every section.
- One medium border radius on everything.
- Invented social proof: logo rows, star ratings, "10,000+ teams".
- In an app: no empty, loading, or error state; no sign of the current page in navigation; a focus ring missing or never styled.
