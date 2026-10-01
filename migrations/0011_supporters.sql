-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0011 — Sponsors & partners                         ║
-- ║  A single table for the people/teams listed on the public     ║
-- ║  Project page's Sponsors and Partners sections (kind tells    ║
-- ║  them apart). A section only shows once it has an entry.      ║
-- ║  Additive only.                                               ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS supporters (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL CHECK (kind IN ('sponsor', 'partner')),
    name        TEXT NOT NULL,
    description TEXT,
    logo_url    TEXT,
    website_url TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supporters_kind ON supporters(kind, sort_order);
