-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0006 — Song of the Day                              ║
-- ║  Adds daily_song_picks, which records the one song randomly    ║
-- ║  chosen (via SQL RANDOM()) for each UTC calendar date, so the  ║
-- ║  featured "Song of the Day" on the homepage changes once a day ║
-- ║  but stays the same for every visitor across that whole day.   ║
-- ║  Additive only — no data is dropped.                           ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS daily_song_picks (
    date       TEXT PRIMARY KEY,
    song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
