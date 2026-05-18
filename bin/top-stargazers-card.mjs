#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = {
  limit: 6,
  maxStargazers: 500,
  minFollowers: 0,
  concurrency: 8,
  output: "top-stargazers.svg",
  theme: "light",
  mode: "top",
};

const superstarsPath = new URL("../data/superstars.json", import.meta.url);

export const demoUsers = [
  { login: "torvalds", name: "Linus Torvalds", followers: 250000, public_repos: 8, html_url: "https://github.com/torvalds" },
  { login: "gaearon", name: "Dan Abramov", followers: 90000, public_repos: 330, html_url: "https://github.com/gaearon" },
  { login: "sindresorhus", name: "Sindre Sorhus", followers: 74000, public_repos: 1200, html_url: "https://github.com/sindresorhus" },
  { login: "addyosmani", name: "Addy Osmani", followers: 46000, public_repos: 210, html_url: "https://github.com/addyosmani" },
  { login: "yyx990803", name: "Evan You", followers: 43000, public_repos: 120, html_url: "https://github.com/yyx990803" },
  { login: "defunkt", name: "Chris Wanstrath", followers: 22000, public_repos: 110, html_url: "https://github.com/defunkt" },
];

if (isCliEntry()) {
  main().catch((error) => {
    console.error(`top-stargazers-card: ${error.message}`);
    process.exitCode = 1;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const svg = options.mode === "superstars"
    ? await buildSuperstarsSvg(options)
    : await buildTopStargazersSvg(options);

  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, svg, "utf8");
  console.log(`Wrote ${output}`);
}

export async function buildTopStargazersSvg(input) {
  const options = normalizeOptions(input);
  const repo = parseRepo(options.repo);
  const users = options.demo
    ? demoUsers
    : await fetchTopStargazers(repo, options);

  const filtered = users
    .filter((user) => Number(user.followers ?? 0) >= options.minFollowers)
    .filter((user) => !options.excludeBots || !isBotLike(user.login))
    .sort((a, b) => Number(b.followers ?? 0) - Number(a.followers ?? 0))
    .slice(0, options.limit);

  return renderSvg({
    repo: `${repo.owner}/${repo.name}`,
    users: filtered,
    sampled: users.length,
    maxStargazers: options.demo ? demoUsers.length : options.maxStargazers,
    generatedAt: new Date(),
    theme: options.theme,
  });
}

export async function buildSuperstarsSvg(input) {
  const options = normalizeOptions(input);
  const repo = parseRepo(options.repo);
  const superstars = options.superstars || await loadSuperstars();
  const stargazers = options.demo
    ? demoUsers
    : await fetchStargazers(repo, options);
  const stargazerByLogin = new Map(stargazers.map((user) => [String(user.login).toLowerCase(), user]));
  const matched = [];

  for (const superstar of superstars) {
    const stargazer = stargazerByLogin.get(superstar.login.toLowerCase());
    if (!stargazer) {
      continue;
    }

    matched.push({
      ...stargazer,
      ...superstar,
      html_url: stargazer.html_url || `https://github.com/${superstar.login}`,
      avatar_url: stargazer.avatar_url || superstar.avatarUrl,
    });
  }

  return renderSuperstarsSvg({
    repo: `${repo.owner}/${repo.name}`,
    users: matched.slice(0, options.limit),
    checked: superstars.length,
    sampled: stargazers.length,
    maxStargazers: options.demo ? demoUsers.length : options.maxStargazers,
    generatedAt: new Date(),
    theme: options.theme,
  });
}

export async function loadSuperstars() {
  return JSON.parse(await readFile(superstarsPath, "utf8"));
}

export function normalizeOptions(input = {}) {
  return {
    ...DEFAULTS,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    ...input,
    limit: toNonNegativeInt(input.limit ?? DEFAULTS.limit, "limit"),
    maxStargazers: toPositiveInt(input.maxStargazers ?? DEFAULTS.maxStargazers, "max-stargazers"),
    minFollowers: toNonNegativeInt(input.minFollowers ?? DEFAULTS.minFollowers, "min-followers"),
    concurrency: toPositiveInt(input.concurrency ?? DEFAULTS.concurrency, "concurrency"),
  };
}

export function parseArgs(args) {
  const options = { ...DEFAULTS, token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const readValue = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case "--repo":
        options.repo = readValue();
        break;
      case "--output":
        options.output = readValue();
        break;
      case "--limit":
        options.limit = toNonNegativeInt(readValue(), "limit");
        break;
      case "--max-stargazers":
        options.maxStargazers = toPositiveInt(readValue(), "max-stargazers");
        break;
      case "--min-followers":
        options.minFollowers = toNonNegativeInt(readValue(), "min-followers");
        break;
      case "--concurrency":
        options.concurrency = toPositiveInt(readValue(), "concurrency");
        break;
      case "--token":
        options.token = readValue();
        break;
      case "--theme":
        options.theme = readValue();
        break;
      case "--mode":
        options.mode = readValue();
        break;
      case "--exclude-bots":
        options.excludeBots = true;
        break;
      case "--demo":
        options.demo = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help && !options.repo) {
    throw new Error("Missing --repo owner/name");
  }

  return options;
}

export function parseRepo(value) {
  const normalized = value
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
  const [owner, name] = normalized.split("/");

  if (!owner || !name || normalized.split("/").length !== 2) {
    throw new Error(`Expected --repo owner/name or https://github.com/owner/name, got "${value}"`);
  }

  return { owner, name };
}

export async function fetchTopStargazers(repo, options) {
  const stargazers = await fetchStargazers(repo, options);
  if (stargazers.length === 0) {
    return [];
  }

  const logins = [...new Set(stargazers.map((user) => user.login).filter(Boolean))];
  return mapWithConcurrency(logins, options.concurrency, (login) => fetchUser(login, options));
}

export async function fetchStargazers(repo, options) {
  const users = [];
  const perPage = 100;
  const pages = Math.ceil(options.maxStargazers / perPage);

  for (let page = 1; page <= pages; page += 1) {
    const remaining = options.maxStargazers - users.length;
    const pageSize = Math.min(perPage, remaining);
    const url = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/stargazers?per_page=${pageSize}&page=${page}`;
    const pageUsers = await githubJson(url, options);

    if (!Array.isArray(pageUsers) || pageUsers.length === 0) {
      break;
    }

    users.push(...pageUsers);

    if (pageUsers.length < pageSize || users.length >= options.maxStargazers) {
      break;
    }
  }

  return users.slice(0, options.maxStargazers);
}

export async function fetchUser(login, options) {
  return githubJson(`https://api.github.com/users/${encodeURIComponent(login)}`, options);
}

async function githubJson(url, options) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "top-stargazers-card",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${url}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export function renderSvg({ repo, users, sampled, maxStargazers, generatedAt, theme }) {
  const palette = theme === "dark"
    ? {
        bg: "#0d1117",
        border: "#30363d",
        title: "#f0f6fc",
        text: "#c9d1d9",
        muted: "#8b949e",
        accent: "#58a6ff",
        chip: "#161b22",
      }
    : {
        bg: "#ffffff",
        border: "#d0d7de",
        title: "#24292f",
        text: "#57606a",
        muted: "#6e7781",
        accent: "#0969da",
        chip: "#f6f8fa",
      };

  const width = 720;
  const rowHeight = 34;
  const top = 86;
  const footerHeight = 46;
  const height = top + Math.max(users.length, 1) * rowHeight + footerHeight;
  const rows = users.length > 0
    ? users.map((user, index) => renderUserRow(user, index, top + index * rowHeight, palette)).join("\n")
    : `<text x="24" y="${top + 18}" font-size="14" fill="${palette.muted}">No stargazers matched the current filters.</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Top stargazers for ${escapeXml(repo)}</title>
  <desc id="desc">Top GitHub stargazers sorted by follower count.</desc>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${palette.bg}" stroke="${palette.border}"/>
  <text x="24" y="34" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="${palette.title}">Top stargazers</text>
  <text x="24" y="58" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" fill="${palette.text}">${escapeXml(repo)} - ranked by GitHub followers</text>
  <rect x="558" y="22" width="138" height="28" rx="14" fill="${palette.chip}" stroke="${palette.border}"/>
  <text x="627" y="41" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" font-weight="600" fill="${palette.accent}">${escapeXml(formatNumber(sampled))} sampled</text>
${rows}
  <text x="24" y="${height - 20}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="${palette.muted}">Generated ${escapeXml(formatDate(generatedAt))} - scanned up to ${escapeXml(formatNumber(maxStargazers))} stargazers</text>
</svg>
`;
}

export function renderSuperstarsSvg({ repo, users, checked, sampled, maxStargazers, generatedAt, theme }) {
  const palette = theme === "dark"
    ? {
        bg: "#0d1117",
        border: "#30363d",
        title: "#f0f6fc",
        text: "#c9d1d9",
        muted: "#8b949e",
        accent: "#f2cc60",
        chip: "#161b22",
      }
    : {
        bg: "#ffffff",
        border: "#d0d7de",
        title: "#24292f",
        text: "#57606a",
        muted: "#6e7781",
        accent: "#9a6700",
        chip: "#fff8c5",
      };

  const width = 760;
  const rowHeight = 58;
  const top = 88;
  const footerHeight = 48;
  const height = top + Math.max(users.length, 1) * rowHeight + footerHeight;
  const rows = users.length > 0
    ? users.map((user, index) => renderSuperstarRow(user, index, top + index * rowHeight, palette)).join("\n")
    : `<text x="24" y="${top + 20}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" fill="${palette.muted}">No superstars found in the sampled stargazers.</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Superstars for ${escapeXml(repo)}</title>
  <desc id="desc">Curated notable accounts found among sampled GitHub stargazers.</desc>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${palette.bg}" stroke="${palette.border}"/>
  <text x="24" y="34" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="${palette.title}">Superstars</text>
  <text x="24" y="58" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" fill="${palette.text}">${escapeXml(repo)} - curated notable stargazers</text>
  <rect x="578" y="22" width="158" height="28" rx="14" fill="${palette.chip}" stroke="${palette.border}"/>
  <text x="657" y="41" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" font-weight="600" fill="${palette.accent}">${escapeXml(formatNumber(users.length))} found</text>
${rows}
  <text x="24" y="${height - 20}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="${palette.muted}">Checked ${escapeXml(formatNumber(checked))} superstars against ${escapeXml(formatNumber(sampled))} sampled stargazers - generated ${escapeXml(formatDate(generatedAt))}</text>
  <text x="620" y="${height - 20}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="${palette.muted}">scan cap ${escapeXml(formatNumber(maxStargazers))}</text>
</svg>
`;
}

function renderSuperstarRow(user, index, y, palette) {
  const login = user.login || "unknown";
  const displayName = user.name ? `${user.name} (@${login})` : `@${login}`;
  const blurb = user.blurb || "Notable GitHub account";
  const profileUrl = user.html_url || `https://github.com/${login}`;
  const avatar = user.avatar_url
    ? `<clipPath id="avatar-${index}"><circle cx="42" cy="${y + 25}" r="18"/></clipPath>
  <image href="${escapeXml(user.avatar_url)}" x="24" y="${y + 7}" width="36" height="36" clip-path="url(#avatar-${index})"/>`
    : `<circle cx="42" cy="${y + 25}" r="18" fill="${palette.chip}" stroke="${palette.border}"/>
  <text x="42" y="${y + 30}" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="${palette.accent}">${escapeXml(login.slice(0, 1).toUpperCase())}</text>`;

  return `  <a href="${escapeXml(profileUrl)}" target="_blank">
    ${avatar}
    <text x="76" y="${y + 20}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="${palette.title}">${escapeXml(truncate(displayName, 52))}</text>
    <text x="76" y="${y + 41}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" fill="${palette.text}">${escapeXml(truncate(blurb, 82))}</text>
  </a>`;
}

function renderUserRow(user, index, y, palette) {
  const rank = index + 1;
  const login = user.login || "unknown";
  const displayName = user.name ? `${user.name} (@${login})` : `@${login}`;
  const repos = Number(user.public_repos ?? 0);
  const followers = Number(user.followers ?? 0);

  return `  <text x="24" y="${y + 21}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="${palette.accent}">#${rank}</text>
  <text x="64" y="${y + 21}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="${palette.title}">${escapeXml(truncate(displayName, 44))}</text>
  <text x="460" y="${y + 21}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" fill="${palette.text}">${escapeXml(formatNumber(followers))} followers</text>
  <text x="600" y="${y + 21}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" fill="${palette.muted}">${escapeXml(formatNumber(repos))} repos</text>`;
}

function isBotLike(login) {
  return /\[bot\]$|bot$|-bot$|^bot-/i.test(login);
}

function toNonNegativeInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${label} must be a non-negative integer`);
  }
  return parsed;
}

function toPositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--${label} must be a positive integer`);
  }
  return parsed;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en", { notation: value >= 10000 ? "compact" : "standard" }).format(value);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function truncate(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function printHelp() {
  console.log(`Usage:
  top-stargazers-card --repo owner/name [options]

Options:
  --repo owner/name          Repository to scan. GitHub URLs are also accepted.
  --output path              SVG output path. Default: top-stargazers.svg
  --limit number             Number of stargazers to show. Default: 6
  --max-stargazers number    Number of stargazers to sample from newest-first API pages. Default: 500
  --min-followers number     Hide users below this follower count. Default: 0
  --concurrency number       Concurrent user profile requests. Default: 8
  --token token              GitHub token. Defaults to GITHUB_TOKEN or GH_TOKEN.
  --theme light|dark         SVG theme. Default: light
  --mode top|superstars      Card type. Default: top
  --exclude-bots             Hide bot-like accounts by login.
  --demo                     Render a demo card without calling GitHub.
  --help                     Show this help.
`);
}

function isCliEntry() {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}
