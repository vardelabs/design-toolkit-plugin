# Contributing

Pull requests are welcome: bug fixes, new checks, clearer skill text, better tests.

## Before You Open a PR

1. **Run the tests.** You need Node 22 or later. The browser tests also need Chrome, Edge, or Chromium, and skip when none is installed.

   ```bash
   node --test scripts/*.test.mjs 'plugins/design-toolkit/tests/*.test.mjs'
   ```

2. **Leave the version alone.** Each release sets it, to match the version of Varde Labs' own copy of the plugin. A check on each PR fails when the version changes.

## Style

- Match the code around your change. The scripts use only Node's standard library, with no npm install, so keep it that way.
- Write comments that say why, not what.
- A test should fail when the behaviour it covers breaks.
- Keep skill text in plain, short sentences.

## After Your PR Merges

This repository is published from Varde Labs' own copy of the plugin. A maintainer carries each merged PR into that copy, keeping you as the commit author, and releases it with a new version. That release then publishes here, and `claude plugin update` picks it up.

## Licence

By contributing, you agree that your work is released under the MIT licence in `LICENSE`.
