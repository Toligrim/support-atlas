-- Dedicated public catalogue database; separate from support-atlas-journal.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, company TEXT,
  area TEXT, published_at TEXT, url TEXT,
  salary_from INTEGER, salary_to INTEGER, currency TEXT, gross INTEGER,
  experience TEXT, schedule TEXT, night_shifts INTEGER, possible_calls INTEGER,
  requirement TEXT, responsibility TEXT, search_groups TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('technical','adjacent','review','client')),
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_kind_rank ON jobs(kind, score DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_experience ON jobs(experience);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
