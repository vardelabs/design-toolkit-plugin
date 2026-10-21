# Contributing

Pull requests are welcome: bug fixes, new checks, clearer skill text, better tests.

## Before You Open a PR

1. **Run the tests.** You need Node 22 or later. The browser tests also need Chrome, Edge, or Chromium, and skip when none is installed.

   ```bash
   node --test scripts/*.test.mjs 'plugins/design-toolkit/tests/*.test.mjs'
   ```

2. **Raise the version** if your change touches anything under `plugins/design-toolkit/`. Claude Code installs a new copy of a plugin only when its version changes, so without a bump nobody gets your change.

   ```bash
   node scripts/version.mjs bump patch
   ```

   Use `patch` for a fix, `minor` for a new feature or a new check, and `major` for a change that breaks how people use the plugin today. The script updates every file that holds the version, so they stay in step. If another PR merges first with the same version, merge `main` into your branch and bump again.

A check on each PR fails when the plugin changed and the version did not go up, or when the files disagree about the version.

## Style

- Match the code around your change. The scripts use only Node's standard library, with no npm install, so keep it that way.
- Write comments that say why, not what.
- A test should fail when the behaviour it covers breaks.
- Keep skill text in plain, short sentences.

## After Your PR Merges

This repository is published from Varde Labs' own copy of the plugin. A maintainer carries each merged PR into that copy, keeping you as the commit author. The next release then publishes it here.

## Licence

By contributing, you agree that your work is released under the MIT licence in `LICENSE`.
