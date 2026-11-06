# Critique: Checking the Material

Adapted for review material from taste-skill's `references/critique.md` (Leonxlnx, MIT; see `../scripts/lib/LICENSE`).

Check the rendered card or sheet, never the code. You wrote the code, so you will read your intent into it. The images show only what is there.

## The Passes

Make each pass on its own.

1. **One second.** Glance at the card or the top of the sheet. Can you say what changed and what its status is? If not, fix the title and the summary.
2. **Plain words.** Read the summary, the titles, and the look-for lines as someone who has not seen the code. If a sentence needs the code to make sense, rewrite it in what the person using the app sees and does, with the app's own labels. A file and line reference, an internal step name, or a note about an impossible state goes in the PR body.
3. **Labels.** Every image has a screen, a state, and a theme. Before and after name their commits.
4. **Same frame.** Before and after share the viewport, the crop, and the scroll position. A difference the change did not cause is noise the reviewer has to rule out.
5. **Fresh frame.** No blur, no half-painted layout, no fallback font, no spinner unless the state is the loading state. The capture time is later than the last commit it shows.
6. **No stray focus ring.** A dialog or menu that a script opened shows no focus ring, unless the state is the focus state. Recapture with `--blur`.
7. **Crop.** Each shot keeps enough of the surrounding screen to show where the content sits. It does not need the full window. A crop flush to its content fails: recapture it with `capture.mjs` and its default `--margin`. A zoom may sit tight when the material also holds the whole-screen pair of the same element. The content is not cut at an edge unless the component itself is cut at that width.
8. **Themes.** Both themes for every state, and the dark shot is really dark.
9. **Inventory.** Every inventoried state is present, or listed under Removed as Impossible with its citation. No state comes from a mock the server cannot produce.
10. **Legibility.** At 100% zoom, the text in each shot reads. No shot is upscaled.
11. **Honesty.** Fixtures are labeled as fixtures. No check is claimed that did not run.

## What to Fix First

Later fixes cannot rescue earlier failures.

1. An impossible state, or a missing one.
2. A stale, blurred, or half-painted frame.
3. A missing label or theme.
4. A mismatched viewport or crop between before and after.
5. Layout of the card or sheet itself.

## The Round Log

For a full sheet, write this in your notes each round. Its problem list feeds the sheet's "What Changed Since the Last Round" section on the next round.

```
ROUND n (head <short sha>, published <date>)
Seen in one second: ...
States: <inventoried> inventoried, <shown> shown, <removed> removed as impossible
Problems, most visible first, each with the image it shows in and the fix:
1. ...
```

Name a problem the way a designer would to a colleague: "the dark before shot is 4px taller than the dark after shot", not "could be cleaner".
