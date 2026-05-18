#!/usr/bin/env node

import { loadSuperstars } from "./superstars.mjs";
import { closePool, getPool, query } from "../lib/db.mjs";

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!token) {
  console.error("GITHUB_TOKEN or GH_TOKEN is required.");
  process.exit(1);
}

try {
  await query(await readSchema());
  const superstars = await loadSuperstars();
  await upsertSuperstars(superstars);

  for (const [index, superstar] of superstars.entries()) {
    console.log(`Syncing ${index + 1}/${superstars.length}: ${superstar.login}`);
    await syncOneSuperstar(superstar);
  }

  console.log("Superstars sync complete.");
} catch (error) {
  console.error(`Sync failed: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}

async function readSchema() {
  const { readFile } = await import("node:fs/promises");
  return readFile(new URL("../sql/schema.sql", import.meta.url), "utf8");
}

async function upsertSuperstars(superstars) {
  for (const [index, superstar] of superstars.entries()) {
    await query(
      `INSERT INTO superstars (login, name, blurb, html_url, list_rank, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (login) DO UPDATE SET
         name = EXCLUDED.name,
         blurb = EXCLUDED.blurb,
         html_url = EXCLUDED.html_url,
         list_rank = EXCLUDED.list_rank,
         updated_at = NOW()`,
      [
        superstar.login,
        superstar.name,
        superstar.blurb,
        `https://github.com/${superstar.login}`,
        index,
      ],
    );
  }
}

async function syncOneSuperstar(superstar) {
  const client = await getPool().connect();
  const startedAt = new Date();

  try {
    await client.query(
      `INSERT INTO superstar_syncs (login, last_started_at, last_error)
       VALUES ($1, $2, NULL)
       ON CONFLICT (login) DO UPDATE SET last_started_at = EXCLUDED.last_started_at, last_error = NULL`,
      [superstar.login, startedAt],
    );

    const profile = await fetchAllStarredRepos(superstar.login);

    await client.query("BEGIN");
    await client.query("DELETE FROM superstar_stars WHERE login = $1", [superstar.login]);
    await client.query(
      `UPDATE superstars
       SET name = COALESCE($2, name),
           avatar_url = $3,
           html_url = $4,
           updated_at = NOW()
       WHERE login = $1`,
      [superstar.login, profile.name, profile.avatarUrl, profile.url],
    );

    for (const repo of profile.repos) {
      await client.query(
        `INSERT INTO superstar_stars (login, repo_full_name, starred_at, discovered_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (login, repo_full_name) DO UPDATE SET
           starred_at = EXCLUDED.starred_at,
           discovered_at = NOW()`,
        [superstar.login, repo.nameWithOwner, repo.starredAt],
      );
    }

    await client.query(
      `UPDATE superstar_syncs
       SET starred_repo_count = $2,
           last_completed_at = NOW(),
           last_error = NULL
       WHERE login = $1`,
      [superstar.login, profile.repos.length],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await query(
      `UPDATE superstar_syncs
       SET last_error = $2
       WHERE login = $1`,
      [superstar.login, error.message],
    );
    throw error;
  } finally {
    client.release();
  }
}

async function fetchAllStarredRepos(login) {
  let cursor = null;
  let profile = null;
  const repos = [];

  do {
    const data = await githubGraphql(
      `query($login: String!, $after: String) {
        user(login: $login) {
          login
          name
          url
          avatarUrl(size: 80)
          starredRepositories(first: 100, after: $after, orderBy: { field: STARRED_AT, direction: DESC }) {
            edges {
              starredAt
              node {
                nameWithOwner
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }`,
      { login, after: cursor },
    );

    const user = data.user;
    if (!user) {
      return { name: null, url: `https://github.com/${login}`, avatarUrl: null, repos };
    }

    profile = user;
    repos.push(...user.starredRepositories.edges.map((edge) => ({
      nameWithOwner: edge.node.nameWithOwner,
      starredAt: edge.starredAt,
    })));

    cursor = user.starredRepositories.pageInfo.hasNextPage
      ? user.starredRepositories.pageInfo.endCursor
      : null;
  } while (cursor);

  return {
    name: profile?.name,
    url: profile?.url || `https://github.com/${login}`,
    avatarUrl: profile?.avatarUrl,
    repos,
  };
}

async function githubGraphql(graphqlQuery, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "superstars-sync",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ query: graphqlQuery, variables }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${payload.errors.map((error) => error.message).join("; ")}`);
  }

  return payload.data;
}
