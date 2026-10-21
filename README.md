# Design Toolkit

A Claude Code plugin for reviewing UI work the way a product design team does. It has four skills:

- **design-spec** makes the review material for a UI change. A small change gets a quick card: one image with every state, each titled and captioned. A bigger build gets a full sheet: a private claude.ai Artifact that is republished to the same URL each round.
- **ui-inspect** measures a screen in a headless browser before you capture it. It finds overflow, clipped or covered text, low contrast, fallback fonts, broken images, and type that is too small.
- **design-audit** lists what looks generic or broken on an existing screen, in the order to fix it. It reports and never edits.
- **clean-copy** cuts interface copy that should not exist, and sets the shape of an error message.

## Install

In Claude Code:

```
/plugin marketplace add vardelabs/design-toolkit-plugin
/plugin install design-toolkit@design-toolkit-plugin
```

Then start a new session. The skills load by themselves when a task fits them, for example "send screenshots of this change", "inspect this screen", or "audit this page".

## Requirements

- Node 22 or later.
- A Chromium-based browser: Chrome, Edge, Chromium, or a Chromium that Playwright downloaded. Set `CHROME_PATH` to choose one. The scripts install nothing.

## Tests

```bash
node --test scripts/*.test.mjs 'plugins/design-toolkit/tests/*.test.mjs'
```

The browser tests skip when no browser is installed.

## Contributing

Pull requests are welcome. See `CONTRIBUTING.md` for the tests to run and the version bump each change needs.

## Licence

MIT, by Varde Labs: see `LICENSE`. Parts are adapted from [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) under the MIT License; each `scripts/lib/LICENSE` holds that notice, and each `scripts/lib/UPSTREAM` records the source commit.
