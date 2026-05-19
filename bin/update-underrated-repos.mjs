#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { closePool, query } from "../lib/db.mjs";

const outputPath = new URL("../Underrated repos noticed by Superstars.md", import.meta.url);

const underratedReposQuery = `
WITH superstar_matches AS (
  SELECT
    ss.repo_full_name,
    COUNT(*) AS superstar_count,
    STRING_AGG(s.login, ', ' ORDER BY s.list_rank) AS superstars
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
  m.superstars,
  r.url,
  r.description
FROM superstar_matches m
JOIN github_repos r ON r.repo_full_name = m.repo_full_name
WHERE r.is_fork IS FALSE
  AND r.pushed_at >= NOW() - INTERVAL '90 days'
ORDER BY
  r.stargazer_count ASC NULLS LAST,
  m.superstar_count DESC,
  r.pushed_at DESC
LIMIT 100;
`;

try {
  const result = await query(underratedReposQuery);
  await writeFile(outputPath, renderMarkdown(result.rows), "utf8");
  console.log(`Wrote ${result.rows.length} underrated repos to ${outputPath.pathname}`);
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

Recently active, non-fork repositories with the fewest GitHub stars that have still been starred by at least one account on the Superstars list, excluding self-stars.

Generated from the indexed database on ${generatedAt}.

| # | Repository | Stars | Last pushed | Superstars | Description |
|---:|---|---:|---|---|---|
${table}

## Query

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
    STRING_AGG(s.login, ', ' ORDER BY s.list_rank) AS superstars
  FROM superstar_stars ss
  JOIN superstars s ON s.login = ss.login
  WHERE lower(split_part(ss.repo_full_name, '/', 1)) <> lower(s.login)
  GROUP BY ss.repo_full_name
  HAVING COUNT(*) >= 2
)

-- Looser activity window.
AND r.pushed_at >= NOW() - INTERVAL '180 days'

-- Ignore tiny/personal repos.
AND r.stargazer_count >= 10
\`\`\`
`;
}

function renderRow(row, rank) {
  const repo = escapeMarkdown(row.repo_full_name);
  const url = row.url || `https://github.com/${row.repo_full_name}`;
  const stars = row.stargazer_count ?? "";
  const pushed = formatDate(row.last_pushed);
  const superstars = escapeMarkdown(row.superstars || "");
  const superstarCount = Number(row.superstar_count || 0);
  const suffix = superstarCount > 1 ? ` (${superstarCount})` : "";
  const description = escapeMarkdown(row.description || "");
  return `| ${rank} | [${repo}](${url}) | ${stars} | ${pushed} | ${superstars}${suffix} | ${description} |`;
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
