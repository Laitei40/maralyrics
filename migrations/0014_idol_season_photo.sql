-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0014 — Mara Idol season photo                      ║
-- ║  A square photo/logo for a season, shown next to the wide     ║
-- ║  cover (like an idol's profile photo). Additive only.         ║
-- ╚══════════════════════════════════════════════════════════════╝

ALTER TABLE idol_seasons ADD COLUMN photo_url TEXT;
