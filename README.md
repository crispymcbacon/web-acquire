# web-acquire

A CLI for fetching protected web pages and, for supported sites, converting them into structured listings. Acquisition providers handle downloading the page, while site adapters parse the response into site-specific data.

## Layout

- `src/core/` — URL checks, adapter selection, sequential search collection, snapshot diffs.
- `src/providers/brightdata/` — Bright Data Web Unlocker, using `fetch`.
- `src/adapters/` — Idealista (detail and search), plus LOCA Barcelona, ShBarcelona, and GuinotPrunera rental search.
- `src/cli.ts` — entry point.

## Setup

```bash
pnpm install
pnpm build
```

Copy `.env.example` to `.env` for local credentials. Values already set in the environment override the file. Do not commit `.env`, and do not print tokens. Linux install steps are in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Commands

`adapter` only names the handler for a URL. It does not download the page. Unknown hosts can still be fetched.

```bash
pnpm web-acquire adapter https://www.idealista.com/inmueble/123/
pnpm web-acquire adapter https://example.com/page
```

`fetch` downloads one URL through Bright Data. By default it writes `runs/<timestamp>-<host>/response.<type>` and `metadata.json`. The response file is `.html`, `.txt`, `.json`, or `.bin`. Failure exits non-zero.

```bash
pnpm web-acquire fetch https://example.com/page
pnpm --silent web-acquire fetch https://example.com/page --json
pnpm web-acquire fetch https://example.com/page --timeout 60 --output-dir ./my-run
```

`--output-dir` is the directory you pass, with nothing appended. Use `--silent` with pnpm when stdout must be JSON only.

`extract` is Idealista only. It fetches the page and writes `listing.json` for a detail URL, or `search.json` for a search URL.

```bash
pnpm web-acquire extract https://www.idealista.com/inmueble/112536871/ --output-dir ./idealista-run
pnpm --silent web-acquire extract https://www.idealista.com/inmueble/112536871/ --json
pnpm web-acquire extract https://www.idealista.com/alquiler-viviendas/barcelona-barcelona/
```

`collect` follows a supported search page by page and writes one schema 2 inventory, plus the files for each page. Search URLs work for Idealista, LOCA Barcelona, ShBarcelona, and GuinotPrunera.

```bash
pnpm web-acquire collect 'https://www.idealista.com/alquiler-viviendas/barcelona-barcelona/' --max-pages 2
pnpm web-acquire collect 'https://www.locabarcelona.com/en/property-search/?status=long-term-rental&bedrooms=3&max-price=2500'
pnpm web-acquire collect 'https://www.shbarcelona.com/apartments-for-rent/long-term?maxPrice=2400&type=9&bedrooms=3'
pnpm web-acquire collect 'https://www.guinotprunera.com/es/alquiler/en-barcelona/con-3_habitaciones_min,5_habitaciones_max,2400_precio_max'
```

`diff` compares two complete inventories offline. Incomplete snapshots are rejected, so a bad scrape is not treated as a removal of every listing. Schema 1 inventories are rejected too; collect again to get schema 2.

```bash
pnpm web-acquire diff runs/old/inventory.json runs/new/inventory.json --output diff.json
```

## Install on Linux

From a checkout already on the machine:

```bash
./scripts/install.sh
```

The script builds the CLI, links `~/.local/bin/web-acquire`, and reads production credentials from `~/.config/web-acquire/.env`. Setup and checks are in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Bright Data

Each acquisition is one POST to `BRIGHTDATA_UNLOCKER_ENDPOINT`, default `https://api.brightdata.com/request`, with the configured API token and zone. Credentials are checked for `fetch`, `extract`, and `collect`. `adapter` and `--help` do not need them. The default timeout is 45 seconds. There are no retries. Responses over 20 MB are dropped.

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
```

Still out of scope: opening Idealista detail pages from a search, Browser API, image download, retries, concurrency, and publishing.
