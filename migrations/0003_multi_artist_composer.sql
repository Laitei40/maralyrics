-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0003 — Multi-artist / multi-composer songs         ║
-- ║  Adds song_artists / song_composers junction tables so a song ║
-- ║  can credit more than one artist or composer (up to 20 each,  ║
-- ║  enforced in the API). songs.artist_id / composer_id are kept ║
-- ║  as the "primary" (first) credited person for backward        ║
-- ║  compatibility with existing indexes/queries.                 ║
-- ║  Additive only — no data is dropped. Existing single           ║
-- ║  artist_id/composer_id values are backfilled as the first      ║
-- ║  (position 0) entry in the new junction tables.                ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS song_artists (
    song_id   INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (song_id, artist_id)
);

CREATE TABLE IF NOT EXISTS song_composers (
    song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    composer_id INTEGER NOT NULL REFERENCES composers(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (song_id, composer_id)
);

CREATE INDEX IF NOT EXISTS idx_song_artists_artist_id ON song_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_song_composers_composer_id ON song_composers(composer_id);

INSERT OR IGNORE INTO song_artists (song_id, artist_id, position)
    SELECT id, artist_id, 0 FROM songs WHERE artist_id IS NOT NULL;

INSERT OR IGNORE INTO song_composers (song_id, composer_id, position)
    SELECT id, composer_id, 0 FROM songs WHERE composer_id IS NOT NULL;
