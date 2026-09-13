# web-acquire

A small reusable web acquisition CLI for AI agents. It separates **acquisition providers**, which reliably fetch URLs, from **site adapters**, which extract structured data from a particular website.

## Current architecture

- `src/core/`: generic acquisition types, URL validation, and adapter selection.
- `src/providers/brightdata/`: Bright Data Web Unlocker provider skeleton. It validates configuration but intentionally makes no network requests yet.
- `src/adapters/idealista/`: Idealista adapter skeleton for `idealista.com` and `www.idealista.com`; parsing is not implemented yet.
- `src/cli.ts`: command-line entry point.

Adding another site adapter does not require changes to the Bright Data provider.

## Setup

```bash
pnpm install
pnpm build
```

Copy `.env.example` to `.env` only when configuring local credentials. Never commit `.env` or print its values.

## Commands

```bash
pnpm web-acquire adapter https://www.idealista.com/inmueble/123/
pnpm web-acquire adapter https://example.com/page
pnpm web-acquire fetch https://example.com/page
pnpm web-acquire fetch https://example.com/page --json
```

After installation as a package, the same commands are available as `web-acquire ...`.

Adapter detection returns `idealista` for supported Idealista domains and `none (generic)` otherwise. Fetch currently returns a clear not-enabled result; it does not contact Bright Data.

## Planned work

The first real acquisition implementation will use `BRIGHTDATA_API_TOKEN`, `BRIGHTDATA_UNLOCKER_ZONE`, and the optional `BRIGHTDATA_UNLOCKER_ENDPOINT` (defaulting to `https://api.brightdata.com/request`). The Idealista adapter will later parse acquired documents. Browser API, photo downloading, and site-specific extraction are intentionally out of scope for this foundation milestone.

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
```
