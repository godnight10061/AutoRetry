# AutoRetry (SillyTavern Extension)

Automatically clicks **Regenerate** when the latest **assistant** message does not contain a non-empty `<正文>...</正文>` or `<game>...</game>` block.

## What counts as “valid”

The message is considered valid if it contains at least one well-ordered `<正文>...</正文>` or `<game>...</game>` pair whose inner text (after trimming whitespace) is non-empty.

## Install

### Option A: SillyTavern UI (recommended)

1. Open **Extensions**.
2. Click **Install extension** (Import Extension From Git Repo).
3. Paste this repository URL and install: `https://github.com/godnight10061/AutoRetry`

### Option B: Manual

Copy this folder into:

`SillyTavern/public/scripts/extensions/third-party/AutoRetry/`

## Settings

In **Extensions**, look for **AutoRetry (正文 Guard)**:

- **Enabled**: master toggle.
- **Max retries**: how many automatic regenerations to attempt for the same assistant message.
- **Cooldown (ms)**: delay before each auto-regenerate.
- **Stop on manual Regenerate**: if you manually click Regenerate, AutoRetry won’t auto-retry again until you send a new message.

## Logs

Open the browser DevTools console (F12) to see `[AutoRetry] ...` logs (this is a frontend extension, so it won’t show in the server terminal).

Also, in **Extensions → AutoRetry**, there is a built-in **Status** line and **Debug log** panel (with a **Test log** button) so you can confirm AutoRetry is loaded even if your console is filtered.

Common lines:

- `init`: extension loaded + current settings snapshot
- `check`: evaluated the latest assistant message (valid/invalid)
- `retry scheduled` / `regen click` / `max retries reached`

## Compatibility

### Auto-Continue-Timeskip

When `Auto-Continue-Timeskip` is installed and **Auto Continue** is enabled, AutoRetry blocks the extension’s programmatic “continue/timeskip” send until the latest assistant message becomes valid, then allows it exactly once.

If the generation ends with **no assistant message** (e.g. API/streaming failure), AutoRetry treats it as invalid output and retries after a short settle delay.

AutoRetry also ignores the initial assistant greeting before you send any message (so it won’t spam retries on conversation start).

## Local tests

Requires Node.js (no dependencies).

```bash
node --test
```
