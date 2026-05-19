# Operations

This document is for people running or modifying the hosted Superstars service.

## Run Locally

```sh
npm install
npm run serve
```

Then open:

```text
http://localhost:3000/owner/repo.svg?demo=1
```

For real repos, set a GitHub token:

```sh
GITHUB_TOKEN=github_pat_xxx npm run serve
```

Then request:

```text
http://localhost:3000/facebook/react.svg?limit=8
```

## Persistent Index

For production, use a Postgres database such as Neon. The web service reads from `DATABASE_URL` when indexed data exists, so README image renders do not need to crawl GitHub.

Set these environment variables on the web service:

```text
DATABASE_URL=postgres://...
GITHUB_TOKEN=github_pat_xxx
```

Run the migration once:

```sh
npm run db:migrate
```

Then run the sync job to index every account in [`superstars.json`](../superstars.json):

```sh
npm run sync
```

The sync job stores each superstar's starred repositories in Postgres. After that, badge requests do a fast lookup:

```text
repo -> matching superstars
```

## GitHub Actions Scheduler

The included GitHub Actions workflow, [`.github/workflows/sync-superstars.yml`](../.github/workflows/sync-superstars.yml), runs `npm run sync` every 6 hours.

Add these repository secrets:

```text
DATABASE_URL=<your Neon connection string>
SUPERSTARS_GITHUB_TOKEN=<GitHub token>
```

You can also run it manually from the GitHub Actions tab with **Run workflow**.

## Deploy

This repo includes a `Dockerfile` and `render.yaml`.

For Render:

1. Create or use the existing Render web service.
2. Add `DATABASE_URL` from Neon as a secret environment variable.
3. Add `GITHUB_TOKEN` as a secret environment variable.
4. Deploy.
5. Add the same `DATABASE_URL` and `SUPERSTARS_GITHUB_TOKEN` secrets to GitHub Actions.
6. Run the **Sync superstars index** workflow once, or wait for its schedule.
7. Embed `https://your-service.onrender.com/owner/repo.svg` in a README.

Any Docker host works too:

```sh
docker build -t superstars .
docker run -p 3000:3000 -e DATABASE_URL=postgres://... -e GITHUB_TOKEN=github_pat_xxx superstars
```

The server caches rendered cards in memory. Set `CACHE_TTL_SECONDS` to tune the cache duration. Set `PORT` to change the HTTP port.

## CLI

```sh
npx superstars --repo owner/repo --output superstars.svg
```

For local development in this repo:

```sh
node ./bin/superstars.mjs --repo owner/repo --output superstars.svg
```

Render a no-network demo card:

```sh
node ./bin/superstars.mjs --demo --repo owner/repo --output superstars.svg
```
