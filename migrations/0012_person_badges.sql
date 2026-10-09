-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0012 — Artist / composer badges                    ║
-- ║  Recognition badges a Super Admin can award to one artist or  ║
-- ║  one composer for a month ('YYYY-MM'), a year ('YYYY') or for ║
-- ║  a lifetime (no date). A person can hold many badges; the     ║
-- ║  same period can only be awarded once per person. Rows are    ║
-- ║  removed with the person (ON DELETE CASCADE).                 ║
-- ║  Additive only.                                               ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS person_badges (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_id    INTEGER REFERENCES artists(id) ON DELETE CASCADE,
    composer_id  INTEGER REFERENCES composers(id) ON DELETE CASCADE,
    period       TEXT NOT NULL CHECK (period IN ('month', 'year', 'lifetime')),
    period_value TEXT NOT NULL DEFAULT '',   -- 'YYYY-MM' | 'YYYY' | '' (lifetime)
    title        TEXT,                        -- optional custom label; NULL = the standard one
    awarded_by   INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- exactly one of artist / composer
    CHECK ((artist_id IS NOT NULL AND composer_id IS NULL) OR (artist_id IS NULL AND composer_id IS NOT NULL)),
    -- the value must match the period
    CHECK (
        (period = 'lifetime' AND period_value = '')
        OR (period = 'year'  AND period_value GLOB '[0-9][0-9][0-9][0-9]')
        OR (period = 'month' AND period_value GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]')
    )
);

-- One badge per person per period (partial indexes: a NULL id never collides)
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_badges_artist   ON person_badges(artist_id, period, period_value)   WHERE artist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_badges_composer ON person_badges(composer_id, period, period_value) WHERE composer_id IS NOT NULL;
