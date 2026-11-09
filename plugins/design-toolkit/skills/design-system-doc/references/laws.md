# Measurable Laws

Thresholds for the Measured Rules section of a `DESIGN.md`. Each line names the ui-inspect rule that checks it, or says that no tool measures it. When the repo's own values are stricter, the repo's values win.

Adapted from taste-skill's `references/type.md`, `colour.md`, and `layout.md`, and the anti-pattern list in its `stitch-skill`. See `UPSTREAM`.

## Type

| Law | ui-inspect |
|---|---|
| Two typefaces at most: one for headings, one for everything else. A third face for labels or numbers is a drift. | `font-count` (WARN at 3, FAIL over 3) |
| Every named face loads. A face that falls back is a different face. | `font-fallback` |
| Few sizes, far apart. Nine sizes at most on one screen; a repo scale usually has five or six. | `size-count` |
| No text under 12px. Secondary text is the same face in a softer ink, not 11px. | `small-text` |
| Running text holds 45 to 75 characters per line. | `measure` (WARN past about 88) |
| Body text is 16 to 18px, with leading 1.45 to 1.6. | not measured |
| Do not centre paragraphs longer than three lines. Do not justify. | not measured |

## Colour

| Law | ui-inspect |
|---|---|
| Text contrast is at least 4.5:1, or 3:1 for large text, in light and in dark. Muted text is where dark themes fail. | `contrast` |
| One accent. It marks the action and at most one other recurring thing, and covers under 5% of a screen. | not measured |
| Name colours by role (background, text, muted, accent, border, danger), never by hue. | not measured |
| A dark theme sets `color-scheme: dark` on the root, so form controls and scrollbars follow. | not measured |
| Depth on a dark ground comes from a lighter surface step, not from glows. | not measured |

## Layout

| Law | ui-inspect |
|---|---|
| The page never scrolls sideways at any width. | `overflow` |
| A row that scrolls sideways is a table, a grid, or a tab list, or is marked `data-scroll-x`. | `side-scroll` |
| No text is cut off by its box or covered by another element. | `clipped-text`, `covered-text` |
| An icon beside text sits on the middle of the capital letters. | `optical-align` |
| Spacing comes from the scale. A gap between groups is clearly larger than any gap inside one. | not measured |
| Touch targets are at least 44px high on a phone. | not measured |
| Keyboard focus is visible on every control, in light and dark. | not measured |

## Common Generated-UI Tells

Put one of these under Banned Patterns only when the repo shows it is unwanted. Otherwise ask the owner under Open Questions.

- Emoji used as interface icons.
- Gradient text on headings; neon or coloured glows.
- Violet or blue-violet accents picked by default rather than by the brand.
- Pure black (`#000`) text or grounds where the palette has an off-black.
- Three equal cards in a row as the default feature layout.
- Stock copy: "Elevate", "Seamless", "Unleash", "Next-gen"; placeholder names such as "John Doe" or "Acme".
- Filler hints such as "Scroll to explore", and bouncing arrows.
- A spinner where a skeleton of the real layout fits.
