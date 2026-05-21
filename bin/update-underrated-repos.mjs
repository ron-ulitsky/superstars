#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { closePool, query } from "../lib/db.mjs";

const outputPath = new URL("../Underrated repos noticed by Superstars.md", import.meta.url);
const reportLimit = 100;
const candidateLimit = 500;

const underratedReposQuery = `
WITH superstar_matches AS (
  SELECT
    ss.repo_full_name,
    COUNT(*) AS superstar_count,
    STRING_AGG(s.login, ', ' ORDER BY s.list_rank) AS superstar_logins,
    STRING_AGG(
      CONCAT(
        COALESCE(NULLIF(s.name, ''), s.login),
        ' (@',
        s.login,
        ')',
        CASE
          WHEN s.blurb IS NULL OR trim(s.blurb) = '' THEN ''
          ELSE CONCAT(' - ', s.blurb)
        END
      ),
      '<br>' ORDER BY s.list_rank
    ) AS superstar_details
  FROM superstar_stars ss
  JOIN superstars s ON s.login = ss.login
  WHERE lower(split_part(ss.repo_full_name, '/', 1)) <> lower(s.login)
  GROUP BY ss.repo_full_name
)
SELECT
  r.repo_full_name,
  r.stargazer_count,
  r.pushed_at::date AS last_pushed,
  m.superstar_count,
  m.superstar_logins,
  m.superstar_details,
  r.url,
  r.description
FROM superstar_matches m
JOIN github_repos r ON r.repo_full_name = m.repo_full_name
WHERE r.is_fork IS FALSE
  AND r.stargazer_count BETWEEN 500 AND 1000
  AND r.description IS NOT NULL
  AND length(trim(r.description)) > 0
  AND lower(split_part(r.repo_full_name, '/', 2)) <> lower(split_part(r.repo_full_name, '/', 1))
  AND lower(split_part(r.repo_full_name, '/', 2)) !~ '(^|[-_.])(dotfiles?|resume|cv|homepage|website|portfolio|profile)([-_.]|$)'
  AND lower(r.description) !~ '(^|\\W)(dotfiles?|resume|cv|homepage|personal website|portfolio|profile)(\\W|$)'
  AND r.pushed_at >= NOW() - INTERVAL '90 days'
ORDER BY
  r.stargazer_count ASC NULLS LAST,
  m.superstar_count DESC,
  r.pushed_at DESC
LIMIT ${candidateLimit};
`;

try {
  const result = await query(underratedReposQuery);
  const rows = await excludeContributorRepos(result.rows);
  await writeFile(outputPath, renderMarkdown(rows), "utf8");
  console.log(`Wrote ${rows.length} underrated repos to ${outputPath.pathname}`);
} catch (error) {
  console.error(`Failed to update underrated repos: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}

function renderMarkdown(rows) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const table = rows.length
    ? rows.map((row, index) => renderRow(row, index + 1)).join("\n")
    : "| - | No matching repositories found. | - | - | - | - |";

  return `# Underrated Repos Noticed by Superstars

Recently active, non-fork repositories with 500-1000 GitHub stars and a non-empty description that have still been starred by at least one account on the Superstars list, excluding profile/personal repos, self-stars, and repos where a matching Superstar is a commit contributor.

Generated from the indexed database on ${generatedAt}.

| # | Repository | Stars | Last pushed | Superstars | Description |
|---:|---|---:|---|---|---|
${table}

## Query

The SQL query fetches candidate repositories and excludes self-stars. The report script then calls GitHub's contributors API and removes repositories where a matching Superstar is a commit contributor.

\`\`\`sql
${underratedReposQuery.trim()}
\`\`\`

## Useful Variations

\`\`\`sql
-- Stricter: at least two Superstars noticed it.
WITH superstar_matches AS (
  SELECT
    ss.repo_full_name,
    COUNT(*) AS superstar_count,
    STRING_AGG(s.login, ', ' ORDER BY s.list_rank) AS superstar_logins,
    STRING_AGG(
      CONCAT(
        COALESCE(NULLIF(s.name, ''), s.login),
        ' (@',
        s.login,
        ')',
        CASE
          WHEN s.blurb IS NULL OR trim(s.blurb) = '' THEN ''
          ELSE CONCAT(' - ', s.blurb)
        END
      ),
      '<br>' ORDER BY s.list_rank
    ) AS superstar_details
  FROM superstar_stars ss
  JOIN superstars s ON s.login = ss.login
  WHERE lower(split_part(ss.repo_full_name, '/', 1)) <> lower(s.login)
  GROUP BY ss.repo_full_name
  HAVING COUNT(*) >= 2
)

-- Looser activity window.
AND r.pushed_at >= NOW() - INTERVAL '180 days'
\`\`\`
`;
}

async function excludeContributorRepos(rows) {
  const filtered = [];

  for (const row of rows) {
    if (filtered.length >= reportLimit) {
      break;
    }

    const superstarLogins = row.superstar_logins
      .split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean);

    if (await hasContributor(row.repo_full_name, superstarLogins)) {
      continue;
    }

    filtered.push(row);
  }

  return filtered;
}

async function hasContributor(repoFullName, logins) {
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    return false;
  }

  const targets = new Set(logins);
  let page = 1;

  while (page <= 4) {
    const contributors = await fetchContributors(repoFullName, page);
    if (contributors.length === 0) {
      return false;
    }

    if (contributors.some((contributor) => targets.has(contributor.login?.toLowerCase()))) {
      return true;
    }

    if (contributors.length < 100) {
      return false;
    }

    page += 1;
  }

  return false;
}

async function fetchContributors(repoFullName, page) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${repoFullName}/contributors?per_page=100&page=${page}&anon=false`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "superstars",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (response.status === 204 || response.status === 404 || response.status === 409) {
    return [];
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub contributors ${response.status} for ${repoFullName}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

function renderRow(row, rank) {
  const repo = escapeMarkdown(row.repo_full_name);
  const url = row.url || `https://github.com/${row.repo_full_name}`;
  const stars = row.stargazer_count ?? "";
  const pushed = formatDate(row.last_pushed);
  const superstars = formatSuperstars(row.superstar_details || row.superstar_logins || "");
  const superstarCount = Number(row.superstar_count || 0);
  const suffix = superstarCount > 1 ? ` (${superstarCount})` : "";
  const description = escapeMarkdown(row.description || "");
  return `| ${rank} | [${repo}](${url}) | ${stars} | ${pushed} | ${superstars}${suffix} | ${description} |`;
}

function formatSuperstars(value) {
  return String(value)
    .split("<br>")
    .map((entry) => escapeMarkdown(entry.trim()))
    .filter(Boolean)
    .join("<br>");
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toISOString().slice(0, 10);
}

function escapeMarkdown(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}
