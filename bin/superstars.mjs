#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = {
  limit: 6,
  maxStarredReposPerUser: 1000,
  batchSize: 10,
  output: "superstars.svg",
  theme: "light",
  format: "card",
};

const superstarsPath = new URL("../data/superstars.json", import.meta.url);
const listRepo = "ron-ulitsky/superstars";
const listUrl = "https://github.com/ron-ulitsky/superstars";

export const demoUsers = [
  { login: "torvalds", name: "Linus Torvalds", html_url: "https://github.com/torvalds" },
  { login: "gaearon", name: "Dan Abramov", html_url: "https://github.com/gaearon" },
  { login: "sindresorhus", name: "Sindre Sorhus", html_url: "https://github.com/sindresorhus" },
  { login: "addyosmani", name: "Addy Osmani", html_url: "https://github.com/addyosmani" },
  { login: "yyx990803", name: "Evan You", html_url: "https://github.com/yyx990803" },
  { login: "defunkt", name: "Chris Wanstrath", html_url: "https://github.com/defunkt" },
];

if (isCliEntry()) {
  main().catch((error) => {
    console.error(`superstars: ${error.message}`);
    process.exitCode = 1;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const svg = await buildSuperstarsSvg(options);
  const output = resolve(options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, svg, "utf8");
  console.log(`Wrote ${output}`);
}

export async function buildSuperstarsSvg(input) {
  const options = normalizeOptions(input);
  const repo = parseRepo(options.repo);
  const superstars = options.superstars || await loadSuperstars();
  const result = options.demo
    ? buildDemoResult(superstars)
    : await findSuperstarMatches(repo, superstars, options);
  const users = await hydrateAvatarDataUrls(result.matches.slice(0, options.limit));

  return renderSuperstarsSvg({
    repo: `${repo.owner}/${repo.name}`,
    users,
    checked: result.checked || superstars.length,
    scanned: result.scanned,
    maxStarredReposPerUser: options.demo ? demoUsers.length : options.maxStarredReposPerUser,
    indexed: Boolean(result.indexed),
    generatedAt: new Date(),
    theme: options.theme,
    format: options.format,
  });
}

export async function loadSuperstars() {
  return JSON.parse(await readFile(superstarsPath, "utf8"));
}

export function normalizeOptions(input = {}) {
  return {
    ...DEFAULTS,
    token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    databaseUrl: process.env.DATABASE_URL,
    ...input,
    limit: toNonNegativeInt(input.limit ?? DEFAULTS.limit, "limit"),
    maxStarredReposPerUser: toPositiveInt(
      input.maxStarredReposPerUser ?? input.maxStargazers ?? DEFAULTS.maxStarredReposPerUser,
      "max-starred-repos-per-user",
    ),
    batchSize: toPositiveInt(input.batchSize ?? DEFAULTS.batchSize, "batch-size"),
    format: normalizeFormat(input.format ?? DEFAULTS.format),
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
        options.maxStarredReposPerUser = toPositiveInt(readValue(), "max-stargazers");
        break;
      case "--max-starred-repos-per-user":
        options.maxStarredReposPerUser = toPositiveInt(readValue(), "max-starred-repos-per-user");
        break;
      case "--batch-size":
        options.batchSize = toPositiveInt(readValue(), "batch-size");
        break;
      case "--token":
        options.token = readValue();
        break;
      case "--theme":
        options.theme = readValue();
        break;
      case "--format":
        options.format = readValue();
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

function buildDemoResult(superstars) {
  const demoByLogin = new Map(demoUsers.map((user) => [user.login.toLowerCase(), user]));
  const matches = [];

  for (const superstar of superstars) {
    const demoUser = demoByLogin.get(superstar.login.toLowerCase());
    if (demoUser) {
      matches.push({
        ...demoUser,
        ...superstar,
        html_url: demoUser.html_url || `https://github.com/${superstar.login}`,
        avatar_url: demoUser.avatar_url || superstar.avatarUrl,
      });
    }
  }

  return { matches, scanned: demoUsers.length };
}

async function hydrateAvatarDataUrls(users) {
  return Promise.all(users.map(async (user) => {
    if (!user.avatar_url) {
      return user;
    }

    try {
      return {
        ...user,
        avatar_data_url: await fetchAvatarDataUrl(user.avatar_url),
      };
    } catch {
      return user;
    }
  }));
}

async function fetchAvatarDataUrl(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "superstars",
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Avatar fetch ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function findSuperstarMatches(repo, superstars, options) {
  if (options.databaseUrl) {
    const indexed = await findIndexedSuperstarMatches(repo, superstars, options);
    if (indexed) {
      return indexed;
    }
  }

  if (!options.token) {
    throw new Error("GITHUB_TOKEN or GH_TOKEN is required for GraphQL superstar checks");
  }

  const target = `${repo.owner}/${repo.name}`.toLowerCase();
  const states = superstars.map((superstar) => ({
    superstar,
    cursor: null,
    done: false,
    scanned: 0,
  }));
  const matches = [];
  let scanned = 0;

  while (states.some((state) => !state.done)) {
    const batch = states
      .filter((state) => !state.done)
      .slice(0, options.batchSize);

    const result = await fetchStarredRepositoryBatch(batch, options);

    for (const state of batch) {
      const user = result[state.superstar.login];
      if (!user) {
        state.done = true;
        continue;
      }

      const starred = user.starredRepositories;
      const repos = starred.nodes || [];
      const found = repos.some((starredRepo) => starredRepo.nameWithOwner.toLowerCase() === target);
      state.scanned += repos.length;
      scanned += repos.length;

      if (found) {
        matches.push({
          ...state.superstar,
          login: user.login || state.superstar.login,
          name: state.superstar.name || user.name,
          html_url: user.url || `https://github.com/${state.superstar.login}`,
          avatar_url: user.avatarUrl || state.superstar.avatarUrl,
        });
        state.done = true;
        continue;
      }

      if (!starred.pageInfo.hasNextPage || state.scanned >= options.maxStarredReposPerUser) {
        state.done = true;
        continue;
      }

      state.cursor = starred.pageInfo.endCursor;
    }
  }

  return { matches, scanned };
}

async function findIndexedSuperstarMatches(repo, superstars, options) {
  const db = await import("../lib/db.mjs");
  const hasData = await db.hasIndexedData();

  if (!hasData) {
    return null;
  }

  const repoFullName = `${repo.owner}/${repo.name}`;
  const [matches, stats] = await Promise.all([
    db.getIndexedSuperstarMatches(repoFullName, options.limit),
    db.getIndexStats(),
  ]);

  return {
    matches,
    scanned: stats.scanned,
    checked: stats.checked || superstars.length,
    indexed: true,
  };
}

async function fetchStarredRepositoryBatch(states, options) {
  const variables = {};
  const fields = states.map((state, index) => {
    variables[`login${index}`] = state.superstar.login;
    variables[`after${index}`] = state.cursor;
    variables[`first${index}`] = Math.min(100, options.maxStarredReposPerUser - state.scanned);

    return `u${index}: user(login: $login${index}) {
      login
      name
      url
      avatarUrl(size: 80)
      starredRepositories(first: $first${index}, after: $after${index}, orderBy: { field: STARRED_AT, direction: DESC }) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          nameWithOwner
        }
      }
    }`;
  }).join("\n");

  const declarations = states
    .map((_, index) => `$login${index}: String!, $after${index}: String, $first${index}: Int!`)
    .join(", ");
  const query = `query(${declarations}) { ${fields} }`;
  const data = await githubGraphql(query, variables, options);
  const users = {};

  states.forEach((state, index) => {
    users[state.superstar.login] = data[`u${index}`];
  });

  return users;
}

async function githubGraphql(query, variables, options) {
  const headers = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "superstars",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub GraphQL ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${payload.errors.map((error) => error.message).join("; ")}`);
  }

  return payload.data;
}

export function renderSuperstarsSvg({ repo, users, checked, scanned, maxStarredReposPerUser, indexed, generatedAt, theme, format }) {
  const palette = getPalette(theme);

  if (format === "compact") {
    return renderCompactSuperstarsSvg({ repo, users, checked, scanned, generatedAt, palette });
  }

  if (format === "compact-blurbs") {
    return renderCompactBlurbsSuperstarsSvg({ repo, users, checked, scanned, generatedAt, palette });
  }

  const width = 760;
  const rowHeight = 58;
  const top = 88;
  const footerHeight = 66;
  const height = top + Math.max(users.length, 1) * rowHeight + footerHeight;
  const rows = users.length > 0
    ? users.map((user, index) => renderSuperstarRow(user, index, top + index * rowHeight, palette)).join("\n")
    : `<text x="24" y="${top + 20}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" fill="${palette.muted}">No notable matches found for this repository.</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Notable people who starred ${escapeXml(repo)}</title>
  <desc id="desc">Notable accounts from ${escapeXml(listRepo)} that starred this GitHub repository.</desc>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${palette.bg}" stroke="${palette.border}"/>
  <text x="24" y="34" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="${palette.title}">Notable people who starred this project</text>
  <text x="24" y="58" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" fill="${palette.text}">${escapeXml(repo)} - matches from the Superstars list</text>
  <rect x="578" y="22" width="158" height="28" rx="14" fill="${palette.chip}" stroke="${palette.border}"/>
  <text x="657" y="41" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" font-weight="600" fill="${palette.accent}">${escapeXml(formatNumber(users.length))} found</text>
${rows}
  <a href="${escapeXml(listUrl)}" target="_blank">
    <text x="24" y="${height - 38}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="${palette.accent}">Superstars list: ${escapeXml(listRepo)}</text>
  </a>
  <text x="24" y="${height - 20}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="${palette.muted}">Checked ${escapeXml(formatNumber(checked))} superstars across ${escapeXml(formatNumber(scanned))} starred repos - generated ${escapeXml(formatDate(generatedAt))}</text>
  <text x="${indexed ? 606 : 562}" y="${height - 20}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="${palette.muted}">${indexed ? "indexed" : `per-user cap ${escapeXml(formatNumber(maxStarredReposPerUser))}`}</text>
</svg>
`;
}

function renderCompactSuperstarsSvg({ repo, users, checked, scanned, generatedAt, palette }) {
  const width = 760;
  const horizontalPadding = 24;
  const top = 76;
  const itemHeight = 38;
  const footerHeight = 44;
  const columns = users.length > 8 ? 3 : users.length > 3 ? 2 : 1;
  const rowCount = Math.max(1, Math.ceil(Math.max(users.length, 1) / columns));
  const columnWidth = (width - horizontalPadding * 2) / columns;
  const height = top + rowCount * itemHeight + footerHeight;
  const rows = users.length > 0
    ? users
        .map((user, index) => renderCompactSuperstarItem(user, index, top, rowCount, columnWidth, horizontalPadding, itemHeight, palette))
        .join("\n")
    : `<text x="24" y="${top + 18}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" fill="${palette.muted}">No notable matches found for this repository.</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Notable people who starred ${escapeXml(repo)}</title>
  <desc id="desc">Compact list of notable accounts from ${escapeXml(listRepo)} that starred this GitHub repository.</desc>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${palette.bg}" stroke="${palette.border}"/>
  <text x="24" y="32" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="19" font-weight="700" fill="${palette.title}">Notable people who starred this project</text>
  <text x="24" y="55" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" fill="${palette.text}">${escapeXml(repo)} - matches from the Superstars list</text>
${rows}
  <a href="${escapeXml(listUrl)}" target="_blank">
    <text x="24" y="${height - 22}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="${palette.accent}">Superstars list: ${escapeXml(listRepo)}</text>
  </a>
  <text x="250" y="${height - 22}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="${palette.muted}">Checked ${escapeXml(formatNumber(checked))} superstars across ${escapeXml(formatNumber(scanned))} starred repos - ${escapeXml(formatDate(generatedAt))}</text>
</svg>
`;
}

function renderCompactBlurbsSuperstarsSvg({ repo, users, checked, scanned, generatedAt, palette }) {
  const width = 760;
  const horizontalPadding = 24;
  const top = 76;
  const itemHeight = 58;
  const footerHeight = 44;
  const columns = users.length > 2 ? 2 : 1;
  const rowCount = Math.max(1, Math.ceil(Math.max(users.length, 1) / columns));
  const columnWidth = (width - horizontalPadding * 2) / columns;
  const height = top + rowCount * itemHeight + footerHeight;
  const rows = users.length > 0
    ? users
        .map((user, index) => renderCompactBlurbItem(user, index, top, rowCount, columnWidth, horizontalPadding, itemHeight, palette))
        .join("\n")
    : `<text x="24" y="${top + 18}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" fill="${palette.muted}">No notable matches found for this repository.</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Notable people who starred ${escapeXml(repo)}</title>
  <desc id="desc">Compact list with blurbs of notable accounts from ${escapeXml(listRepo)} that starred this GitHub repository.</desc>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${palette.bg}" stroke="${palette.border}"/>
  <text x="24" y="32" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="19" font-weight="700" fill="${palette.title}">Notable people who starred this project</text>
  <text x="24" y="55" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" fill="${palette.text}">${escapeXml(repo)} - matches from the Superstars list</text>
${rows}
  <a href="${escapeXml(listUrl)}" target="_blank">
    <text x="24" y="${height - 22}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="${palette.accent}">Superstars list: ${escapeXml(listRepo)}</text>
  </a>
  <text x="250" y="${height - 22}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="${palette.muted}">Checked ${escapeXml(formatNumber(checked))} superstars across ${escapeXml(formatNumber(scanned))} starred repos - ${escapeXml(formatDate(generatedAt))}</text>
</svg>
`;
}

function renderSuperstarRow(user, index, y, palette) {
  const login = user.login || "unknown";
  const displayName = user.name ? `${user.name} (@${login})` : `@${login}`;
  const blurb = user.blurb || "Notable GitHub account";
  const profileUrl = user.html_url || `https://github.com/${login}`;
  const marker = user.avatar_data_url
    ? `<defs>
      <clipPath id="avatar-${index}">
        <circle cx="42" cy="${y + 25}" r="18"/>
      </clipPath>
    </defs>
    <circle cx="42" cy="${y + 25}" r="18" fill="${palette.chip}" stroke="${palette.border}"/>
    <image href="${escapeXml(user.avatar_data_url)}" x="24" y="${y + 7}" width="36" height="36" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar-${index})"/>
    <circle cx="42" cy="${y + 25}" r="18" fill="none" stroke="${palette.border}"/>`
    : `<circle cx="42" cy="${y + 25}" r="18" fill="${palette.chip}" stroke="${palette.border}"/>
  <text x="42" y="${y + 30}" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="${palette.accent}">${escapeXml(login.slice(0, 1).toUpperCase())}</text>`;

  return `  <a href="${escapeXml(profileUrl)}" target="_blank">
    ${marker}
    <text x="76" y="${y + 20}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="${palette.title}">${escapeXml(truncate(displayName, 52))}</text>
    <text x="76" y="${y + 41}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" fill="${palette.text}">${escapeXml(truncate(blurb, 82))}</text>
  </a>`;
}

function renderCompactSuperstarItem(user, index, top, rowCount, columnWidth, horizontalPadding, itemHeight, palette) {
  const column = Math.floor(index / rowCount);
  const row = index % rowCount;
  const x = horizontalPadding + column * columnWidth;
  const y = top + row * itemHeight;
  const login = user.login || "unknown";
  const displayName = user.name ? `${user.name} (@${login})` : `@${login}`;
  const profileUrl = user.html_url || `https://github.com/${login}`;
  const marker = user.avatar_data_url
    ? `<defs>
      <clipPath id="compact-avatar-${index}">
        <circle cx="${x + 13}" cy="${y + 14}" r="12"/>
      </clipPath>
    </defs>
    <image href="${escapeXml(user.avatar_data_url)}" x="${x + 1}" y="${y + 2}" width="24" height="24" preserveAspectRatio="xMidYMid slice" clip-path="url(#compact-avatar-${index})"/>
    <circle cx="${x + 13}" cy="${y + 14}" r="12" fill="none" stroke="${palette.border}"/>`
    : `<circle cx="${x + 13}" cy="${y + 14}" r="12" fill="${palette.chip}" stroke="${palette.border}"/>
    <text x="${x + 13}" y="${y + 18}" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="10" font-weight="700" fill="${palette.accent}">${escapeXml(login.slice(0, 1).toUpperCase())}</text>`;

  return `  <a href="${escapeXml(profileUrl)}" target="_blank">
    ${marker}
    <text x="${x + 34}" y="${y + 19}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="${palette.title}">${escapeXml(truncate(displayName, columnsTextLimit(columnWidth)))}</text>
  </a>`;
}

function renderCompactBlurbItem(user, index, top, rowCount, columnWidth, horizontalPadding, itemHeight, palette) {
  const column = Math.floor(index / rowCount);
  const row = index % rowCount;
  const x = horizontalPadding + column * columnWidth;
  const y = top + row * itemHeight;
  const login = user.login || "unknown";
  const displayName = user.name ? `${user.name} (@${login})` : `@${login}`;
  const blurb = user.blurb || "Notable GitHub account";
  const profileUrl = user.html_url || `https://github.com/${login}`;
  const marker = user.avatar_data_url
    ? `<defs>
      <clipPath id="compact-blurb-avatar-${index}">
        <circle cx="${x + 15}" cy="${y + 20}" r="14"/>
      </clipPath>
    </defs>
    <image href="${escapeXml(user.avatar_data_url)}" x="${x + 1}" y="${y + 6}" width="28" height="28" preserveAspectRatio="xMidYMid slice" clip-path="url(#compact-blurb-avatar-${index})"/>
    <circle cx="${x + 15}" cy="${y + 20}" r="14" fill="none" stroke="${palette.border}"/>`
    : `<circle cx="${x + 15}" cy="${y + 20}" r="14" fill="${palette.chip}" stroke="${palette.border}"/>
    <text x="${x + 15}" y="${y + 25}" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="11" font-weight="700" fill="${palette.accent}">${escapeXml(login.slice(0, 1).toUpperCase())}</text>`;

  return `  <a href="${escapeXml(profileUrl)}" target="_blank">
    ${marker}
    <text x="${x + 40}" y="${y + 16}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="${palette.title}">${escapeXml(truncate(displayName, columnsTextLimit(columnWidth) - 1))}</text>
    <text x="${x + 40}" y="${y + 37}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="${palette.text}">${escapeXml(truncate(blurb, columnsTextLimit(columnWidth) + 4))}</text>
  </a>`;
}

function columnsTextLimit(columnWidth) {
  return Math.max(18, Math.floor((columnWidth - 42) / 7));
}

function getPalette(theme) {
  return theme === "dark"
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

function normalizeFormat(value) {
  if (value === "card" || value === "compact" || value === "compact-blurbs") {
    return value;
  }

  throw new Error("--format must be card, compact, or compact-blurbs");
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
  superstars --repo owner/name [options]

Options:
  --repo owner/name          Repository to scan. GitHub URLs are also accepted.
  --output path              SVG output path. Default: superstars.svg
  --limit number             Number of superstars to show. Default: 6
  --max-starred-repos-per-user number
                              Number of starred repos to scan per superstar. Default: 1000
  --max-stargazers number    Deprecated alias for --max-starred-repos-per-user.
  --batch-size number        Number of superstars to check in each GraphQL request. Default: 10
  --token token              GitHub token. Defaults to GITHUB_TOKEN or GH_TOKEN.
  --theme light|dark         SVG theme. Default: light
  --format card|compact|compact-blurbs
                              Badge layout. Default: card
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
