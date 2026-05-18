# Superstars

Generate README-friendly SVGs showing curated notable accounts that starred a repository.

```md
![Superstars](https://superstars.onrender.com/owner/repo.svg)
```

The badge checks a curated list of prominent tech and open source accounts, then displays any matches found among the sampled stargazers. The list is visible in the SVG footer:

```text
Superstars list: ron-ulitsky/superstars
```

## Usage

```md
![Superstars](https://superstars.onrender.com/facebook/react.svg)
```

With options:

```md
![Superstars](https://superstars.onrender.com/facebook/react.svg?limit=8&maxStargazers=1000&theme=dark)
```

Supported URL options:

```text
limit=6
maxStargazers=500
theme=light|dark
demo=1
```

`maxStargazers` controls how many stargazers are sampled before checking the Superstars list. GitHub does not expose an API for asking whether arbitrary users starred a repo in bulk, so this is transparent sampling rather than a perfect census for very large repositories.

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
http://localhost:3000/facebook/react.svg?limit=8&maxStargazers=1000
```

## Deploy

This repo includes a `Dockerfile` and `render.yaml`, so the quickest deploy path is Render:

1. Create a new Render Blueprint from this repo.
2. Add `GITHUB_TOKEN` as a secret environment variable.
3. Deploy.
4. Embed `https://your-service.onrender.com/owner/repo.svg` in a README.

Any Docker host works too:

```sh
docker build -t superstars .
docker run -p 3000:3000 -e GITHUB_TOKEN=github_pat_xxx superstars
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
      - run: node ./bin/superstars.mjs --repo "$GITHUB_REPOSITORY" --output superstars.svg --limit 8 --max-stargazers 1000
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "Update superstars card"
          file_pattern: superstars.svg
```
