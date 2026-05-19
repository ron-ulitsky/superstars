# Underrated repos noticed by Superstars

This query finds recently active, non-fork repositories that have been starred by at least one account on the Superstars list, ordered by the fewest GitHub stars first.


Run it against the Neon database after `npm run sync` has populated the index.

```sql
WITH superstar_matches AS (
  SELECT
    ss.repo_full_name,
    COUNT(*) AS superstar_count,
    STRING_AGG(s.login, ', ' ORDER BY s.list_rank) AS superstars
  FROM superstar_stars ss
  JOIN superstars s ON s.login = ss.login
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
```

Useful variations:

```sql
-- Stricter: at least two Superstars noticed it.
WITH superstar_matches AS (
  SELECT
    ss.repo_full_name,
    COUNT(*) AS superstar_count,
    STRING_AGG(s.login, ', ' ORDER BY s.list_rank) AS superstars
  FROM superstar_stars ss
  JOIN superstars s ON s.login = ss.login
  GROUP BY ss.repo_full_name
  HAVING COUNT(*) >= 2
)

-- Looser activity window.
AND r.pushed_at >= NOW() - INTERVAL '180 days'

-- Ignore tiny/personal repos.
AND r.stargazer_count >= 10
```
