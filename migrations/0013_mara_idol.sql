-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0013 — Mara Idol                                   ║
-- ║  Seasons (editions) of the Mara Idol competition and the      ║
-- ║  contestants in each. A season stays a 'draft' (invisible on  ║
-- ║  the public site) until it is published. A contestant can be  ║
-- ║  linked to an existing artist so their songs/badges are one   ║
-- ║  click away. Deleting a season deletes its contestants;       ║
-- ║  deleting an artist only unlinks (SET NULL).                  ║
-- ║  Additive only.                                               ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS idol_seasons (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    year        INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 2100),
    description TEXT,
    venue       TEXT,
    start_date  TEXT CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    end_date    TEXT CHECK (end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    cover_url   TEXT,
    videos      TEXT CHECK (videos IS NULL OR json_valid(videos)),   -- JSON array of { title, url }
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idol_contestants (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id  INTEGER NOT NULL REFERENCES idol_seasons(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL,
    bio        TEXT,
    photo_url  TEXT,
    result     TEXT NOT NULL DEFAULT 'contestant'
               CHECK (result IN ('winner', 'runner_up', 'second_runner_up', 'finalist', 'semi_finalist', 'contestant')),
    placement  INTEGER CHECK (placement IS NULL OR placement >= 1),   -- final position, if known
    videos     TEXT CHECK (videos IS NULL OR json_valid(videos)),     -- JSON array of { title, url }
    artist_id  INTEGER REFERENCES artists(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (season_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_idol_seasons_status_year   ON idol_seasons(status, year DESC);
CREATE INDEX IF NOT EXISTS idx_idol_contestants_season    ON idol_contestants(season_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_idol_contestants_artist    ON idol_contestants(artist_id);
