import pg from "pg";

const { Pool } = pg;

let pool;

export function getPool(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  if (!pool) {
    const isLocal = /localhost|127\.0\.0\.1/.test(databaseUrl);
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });
  }

  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function getIndexedSuperstarMatches(repoFullName, limit) {
  const result = await query(
    `SELECT s.login, s.name, s.blurb, s.avatar_url, s.html_url
     FROM superstar_stars ss
     JOIN superstars s ON s.login = ss.login
     WHERE lower(ss.repo_full_name) = lower($1)
     ORDER BY s.list_rank ASC
     LIMIT $2`,
    [repoFullName, limit],
  );
  return result.rows.map((row) => ({
    login: row.login,
    name: row.name,
    blurb: row.blurb,
    avatar_url: row.avatar_url,
    html_url: row.html_url || `https://github.com/${row.login}`,
  }));
}

export async function getIndexStats() {
  const result = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM superstars) AS checked,
       (SELECT COUNT(*)::int FROM superstar_stars) AS scanned`,
  );
  return result.rows[0] || { checked: 0, scanned: 0 };
}

export async function hasIndexedData() {
  const result = await query("SELECT EXISTS (SELECT 1 FROM superstar_stars LIMIT 1) AS has_data");
  return Boolean(result.rows[0]?.has_data);
}
