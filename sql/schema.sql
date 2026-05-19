CREATE TABLE IF NOT EXISTS superstars (
  login TEXT PRIMARY KEY,
  name TEXT,
  blurb TEXT,
  avatar_url TEXT,
  html_url TEXT,
  list_rank INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS superstar_stars (
  login TEXT NOT NULL REFERENCES superstars(login) ON DELETE CASCADE,
  repo_full_name TEXT NOT NULL,
  starred_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (login, repo_full_name)
);

CREATE INDEX IF NOT EXISTS superstar_stars_repo_full_name_idx
  ON superstar_stars (lower(repo_full_name));

CREATE TABLE IF NOT EXISTS github_repos (
  repo_full_name TEXT PRIMARY KEY,
  url TEXT,
  description TEXT,
  stargazer_count INTEGER,
  is_fork BOOLEAN,
  pushed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS github_repos_discovery_idx
  ON github_repos (is_fork, pushed_at DESC, stargazer_count ASC);

CREATE TABLE IF NOT EXISTS superstar_syncs (
  login TEXT PRIMARY KEY REFERENCES superstars(login) ON DELETE CASCADE,
  starred_repo_count INTEGER NOT NULL DEFAULT 0,
  last_started_at TIMESTAMPTZ,
  last_completed_at TIMESTAMPTZ,
  last_error TEXT
);
