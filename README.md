# Superstars

GitHub stars are useful, but they are a noisy trust signal.

People use star counts to decide which libraries to try, which projects look healthy, which tools deserve attention, and sometimes even which companies or maintainers are worth taking seriously. That makes stars valuable, and valuable metrics get gamed. Recent research on fake GitHub stars found millions of suspected fake stars and notes that star count is widely used as a popularity signal while being vulnerable to artificial inflation ([arXiv](https://arxiv.org/abs/2412.13459)). A shorter summary from SC Media describes the same pattern: fraudulent stars can boost malicious or low-quality repositories, so users should look beyond star count alone ([SC Media](https://www.scworld.com/brief/fraudulent-rating-boosting-stars-prevalent-in-github)).

Superstars adds a different kind of signal: **who** starred a repository.

Instead of treating every star as equal, this project checks whether a repo has been starred by people on a curated list of prominent technical accounts. A star from a known maintainer, language creator, educator, researcher, or respected builder is not proof that a project is good, but it is harder to fake than raw star volume and often more informative than the total count.

Superstars generates README-friendly SVGs showing curated notable accounts that starred a repository.

```md
![Superstars](https://superstars.onrender.com/owner/repo.svg)
```

The badge checks a curated list of prominent tech and open source accounts, then displays any matches whose starred repositories include the target repo. The list is visible in the SVG footer so readers can inspect the source of the signal:

```text
Superstars list: ron-ulitsky/superstars
```

## Usage

```md
![Superstars](https://superstars.onrender.com/facebook/react.svg)
```

With options:

```md
![Superstars](https://superstars.onrender.com/facebook/react.svg?limit=8&maxStarredReposPerUser=1000&theme=dark)
```

Supported URL options:

```text
limit=6
maxStarredReposPerUser=1000
batchSize=10
theme=light|dark
demo=1
```

`maxStarredReposPerUser` controls how many starred repositories are scanned for each account on the Superstars list. GitHub does not expose a direct arbitrary-user check like "did user X star repo Y?", so this scans each superstar's starred repositories with a transparent per-user cap.

## Run Locally

```sh
npm run serve
```

Then open:

```text
http://localhost:3000/owner/repo.svg?demo=1
```

For real repos, set a GitHub token to get higher API limits:

```sh
GITHUB_TOKEN=github_pat_xxx npm run serve
```

Then request:

```text
http://localhost:3000/facebook/react.svg?limit=8&maxStarredReposPerUser=1000
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

Then run the sync job to index every account in [`data/superstars.json`](./data/superstars.json):

```sh
npm run sync
```

The sync job stores each superstar's starred repositories in Postgres. After that, badge requests do a fast lookup:

```text
repo -> matching superstars
```

Schedule `npm run sync` as a cron job to refresh the index. The included `render.yaml` defines a `sync-superstars` cron service that runs every 6 hours.

## Deploy

This repo includes a `Dockerfile` and `render.yaml`, so the quickest deploy path is Render:

1. Create a new Render Blueprint from this repo.
2. Add `DATABASE_URL` from Neon as a secret environment variable.
3. Add `GITHUB_TOKEN` as a secret environment variable.
4. Deploy.
5. Run the `sync-superstars` cron job once, or wait for its schedule.
6. Embed `https://your-service.onrender.com/owner/repo.svg` in a README.

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

## Superstars List

The curated list lives in [`data/superstars.json`](./data/superstars.json). Each entry has a GitHub login, display name, and a short blurb that can appear in the SVG.

Superstar badges may include profile links and avatar images in the raw SVG. In GitHub README Markdown, SVGs are embedded as images, so internal links are usually not clickable and external avatar images may depend on the renderer. The text-only fallback remains the important part.

See [`SUPERSTARS.md`](./SUPERSTARS.md) for how to suggest list additions, removals, blurbs, or a better name than "Superstars."

## GitHub Actions

Most users should prefer the hosted badge. The workflow below is for repos that want to generate and commit their own `superstars.svg` instead of relying on a third-party image URL.

Add this workflow to `.github/workflows/update-superstars.yml`:

```yaml
name: Update superstars card

on:
  workflow_dispatch:
  schedule:
    - cron: "17 3 * * *"

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: node ./bin/superstars.mjs --repo "$GITHUB_REPOSITORY" --output superstars.svg --limit 8 --max-starred-repos-per-user 1000
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "Update superstars card"
          file_pattern: superstars.svg
```
