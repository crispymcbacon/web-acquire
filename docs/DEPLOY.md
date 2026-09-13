# Linux deployment

`web-acquire` is a stateless CLI. The calling Bot owns scheduling, inventory history, retention, and business logic.

## Requirements

- A copied or checked-out repository
- Linux with Node.js **20 or newer**
- pnpm

The intended checkout location is:

```text
/workspace/tools/web-acquire
```

## Install

From the existing checkout:

```bash
cd /workspace/tools/web-acquire
./scripts/install.sh
```

The installer installs dependencies from the lockfile, builds `dist/`, and creates/updates:

```text
~/.local/bin/web-acquire -> /workspace/tools/web-acquire/dist/cli.js
```

It does not clone, publish, edit shell startup files, make acquisition requests, or overwrite credentials. If `~/.local/bin` is not in `PATH`, add it in the Bot's runtime environment, for example:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Running the installer again is safe: the executable link is updated, the existing credential file is preserved, and the dependency/build steps are repeated.

## Credentials

Production credentials should live outside the repository at:

```text
~/.config/web-acquire/.env
```

Create it with:

```dotenv
BRIGHTDATA_API_TOKEN=...
BRIGHTDATA_UNLOCKER_ZONE=grok_unlocker
BRIGHTDATA_UNLOCKER_ENDPOINT=https://api.brightdata.com/request
```

Then secure it:

```bash
chmod 700 ~/.config/web-acquire
chmod 600 ~/.config/web-acquire/.env
```

Configuration lookup order is:

```text
process environment
~/.config/web-acquire/.env
current working directory/.env
```

For each key, process environment values override matching file values, then user config overrides the project-local file. Empty API-token or zone values remain unconfigured; an empty endpoint falls back to `https://api.brightdata.com/request`. The installer creates a non-secret `.env.example` template in the user config directory only when neither the credentials file nor template exists.

A project-local `.env` remains useful for development. Never commit either `.env` file.

## Verification

These checks are offline:

```bash
web-acquire doctor
web-acquire --version
web-acquire adapter https://www.idealista.com/inmueble/123/
```

`doctor` reports only whether credentials are configured, never token contents or derived values. It reports `Network check: not run` and performs no connectivity test.

After credentials are configured, an optional first live test is:

```bash
web-acquire fetch https://geo.brdtest.com/welcome.txt
```

## Caller-owned storage

`web-acquire` does not create or manage history directories. A caller may choose, for example:

```text
/workspace/<bot-or-project>/
  web-acquire/
    snapshots/
    diffs/
```

A Barcelona Bot might use `/workspace/barcelona/housing/`, but this is application-owned and not assumed by the CLI.

## Shared-computer security

Credentials on the destination machine are machine-level credentials available to processes and Bots using that account. Use a dedicated Bright Data key with least privilege; do not reuse Hermes credentials. Revoke the key when it is no longer needed, and do not store unrelated secrets in the repository.
