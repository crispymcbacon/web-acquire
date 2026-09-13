# web-acquire

A small reusable web acquisition CLI for AI agents. It separates **acquisition providers**, which fetch URLs, from **site adapters**, which extract structured data from a particular website.

## Current architecture

- `src/core/`: generic acquisition types, URL validation, and adapter selection.
- `src/providers/brightdata/`: Bright Data Web Unlocker provider using native `fetch`.
- `src/adapters/idealista/`: adapter skeleton for `idealista.com` and `www.idealista.com`; parsing is not implemented yet.
- `src/cli.ts`: command-line entry point.

Adding another site adapter does not require changes to the Bright Data provider.

## Setup

```bash
pnpm install
pnpm build
```

Copy `.env.example` to `.env` for local credentials. Process environment values take precedence over `.env`. Never commit `.env` or print credential values.

## Commands

```bash
pnpm web-acquire adapter https://www.idealista.com/inmueble/123/
pnpm web-acquire adapter https://example.com/page
pnpm web-acquire fetch https://example.com/page
pnpm --silent web-acquire fetch https://example.com/page --json
pnpm web-acquire fetch https://example.com/page --timeout 60 --output-dir ./my-run
```

Adapter detection is independent of acquisition: unknown sites can still be fetched. Fetch uses Bright Data Web Unlocker, creates `runs/<timestamp>-<host>/response.<type>` and `metadata.json` by default (`.html`, `.txt`, `.json`, or `.bin`), and exits non-zero on failure. `--output-dir` uses the supplied directory directly. Use `--silent` with pnpm when stdout must contain only JSON.

## Bright Data configuration

The provider sends one POST request per acquisition to `BRIGHTDATA_UNLOCKER_ENDPOINT`, defaulting to `https://api.brightdata.com/request`, with the configured API token and zone. Credentials are validated only for `fetch`; `adapter` and `--help` do not require them. Requests have a 45-second default timeout, no automatic retries, and a 20 MB retained-response limit.

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
```

Idealista extraction, Browser API, images, retries, concurrency, and publishing are intentionally out of scope for this milestone.
