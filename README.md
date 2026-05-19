# Superstars

GitHub stars are useful, but they are a noisy trust signal.

People use star counts to decide which libraries to try, which projects look healthy, which tools deserve attention, and sometimes even which companies or maintainers are worth taking seriously. That makes stars valuable, and valuable metrics get gamed. Recent research on fake GitHub stars found millions of suspected fake stars and notes that star count is widely used as a popularity signal while being vulnerable to artificial inflation ([arXiv](https://arxiv.org/abs/2412.13459)). A shorter summary from SC Media describes the same pattern: fraudulent stars can boost malicious or low-quality repositories, so users should look beyond star count alone ([SC Media](https://www.scworld.com/brief/fraudulent-rating-boosting-stars-prevalent-in-github)).

Superstars adds a different kind of signal: **who** starred a repository.

Instead of treating every star as equal, this project checks whether a repo has been starred by people on a curated list of prominent technical accounts. A star from a known maintainer, language creator, educator, researcher, or respected builder is not proof that a project is good, but it is harder to fake than raw star volume and often more informative than the total count.

## Try It On Your Repo

Use the live generator:

https://superstars.onrender.com/

Enter a repository, preview the badge, and copy the Markdown snippet for your README.

The badge displays matching accounts from the Superstars list and includes a footer pointing back to the list source:

```text
Superstars list: ron-ulitsky/superstars
```

## Manual Usage

If you prefer to build the URL yourself instead of using the generator, add this to a README:

```md
![Superstars](https://superstars.onrender.com/owner/repo.svg)
```

Example:

```md
![Superstars](https://superstars.onrender.com/facebook/react.svg)
```

With options:

```md
![Superstars](https://superstars.onrender.com/facebook/react.svg?limit=8&theme=dark)
```

Full card format:

```md
![Superstars](https://superstars.onrender.com/facebook/react.svg?format=card)
```

Names-only compact format:

```md
![Superstars](https://superstars.onrender.com/facebook/react.svg?format=compact)
```

Supported URL options:

```text
limit=6
theme=light|dark
format=compact-blurbs|card|compact
```

## How It Works

Superstars maintains a curated list in [`superstars.json`](./superstars.json). Each entry has a GitHub login, display name, and a short blurb describing why the account is notable.

The hosted service indexes the public repositories starred by those accounts. When a badge is requested for `owner/repo`, it looks up which Superstars have starred that repo and renders the matches as an SVG.

This is not a quality guarantee. It is a provenance signal: a compact way to notice when a repository has been starred by people whose technical taste or work may be meaningful to readers.

## The List

The list is intentionally subjective and open to debate. It can include prominent people in tech generally, not only open source maintainers.

See [`SUPERSTARS.md`](./SUPERSTARS.md) to suggest additions, removals, better blurbs, or a better name than "Superstars."

## Notes

Superstar badges embed small avatar snapshots directly in the SVG, with initials as a fallback if an avatar cannot be fetched. Profile links may exist in the raw SVG, but GitHub README Markdown embeds SVGs as images, so internal links are usually not clickable.

Operational details for running the service, syncing the index, and deploying with Render/Neon live in [`docs/operations.md`](./docs/operations.md).

See [`EXAMPLES.md`](./EXAMPLES.md) for sample badges on well-known repositories.
