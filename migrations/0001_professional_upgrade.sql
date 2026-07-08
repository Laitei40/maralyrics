-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0001 — Professional upgrade                       ║
-- ║  Adds: updated_at tracking, CHECK constraints, reports→songs  ║
-- ║  FK link, JSON validation, FTS5 full-text search, indexes.    ║
-- ║  Safe to run once against the existing production database — ║
-- ║  additive only, no data is dropped.                           ║
-- ╚══════════════════════════════════════════════════════════════╝

PRAGMA foreign_keys = OFF;

-- ── copyright_owners: add updated_at (no CHECK needed, simple ADD COLUMN) ──
ALTER TABLE copyright_owners ADD COLUMN updated_at DATETIME;
UPDATE copyright_owners SET updated_at = created_at WHERE updated_at IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_copyright_owners_updated_at
AFTER UPDATE ON copyright_owners
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE copyright_owners SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ── artists: rebuild to add updated_at + validate social_links JSON ──
CREATE TABLE artists_new (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    slug         TEXT UNIQUE NOT NULL,
    bio          TEXT,
    image_url    TEXT,
    social_links TEXT CHECK (social_links IS NULL OR json_valid(social_links)),
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO artists_new (id, name, slug, bio, image_url, social_links, created_at, updated_at)
    SELECT id, name, slug, bio, image_url, social_links, created_at, created_at FROM artists;
DROP TABLE artists;
ALTER TABLE artists_new RENAME TO artists;

CREATE INDEX IF NOT EXISTS idx_artists_slug ON artists(slug);

CREATE TRIGGER IF NOT EXISTS trg_artists_updated_at
AFTER UPDATE ON artists
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE artists SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ── composers: rebuild to add updated_at + validate social_links JSON ──
CREATE TABLE composers_new (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    slug         TEXT UNIQUE NOT NULL,
    bio          TEXT,
    image_url    TEXT,
    social_links TEXT CHECK (social_links IS NULL OR json_valid(social_links)),
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO composers_new (id, name, slug, bio, image_url, social_links, created_at, updated_at)
    SELECT id, name, slug, bio, image_url, social_links, created_at, created_at FROM composers;
DROP TABLE composers;
ALTER TABLE composers_new RENAME TO composers;

CREATE INDEX IF NOT EXISTS idx_composers_slug ON composers(slug);

CREATE TRIGGER IF NOT EXISTS trg_composers_updated_at
AFTER UPDATE ON composers
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE composers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ── songs: rebuild to add updated_at + constrain category to known values ──
CREATE TABLE songs_new (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               TEXT NOT NULL,
    slug                TEXT UNIQUE NOT NULL,
    artist_id           INTEGER,
    composer_id         INTEGER,
    copyright_owner_id  INTEGER,
    category            TEXT CHECK (category IS NULL OR category IN ('Gospel', 'Love', 'Traditional', 'Patriotic')),
    lyrics              TEXT NOT NULL,
    views               INTEGER DEFAULT 0,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL,
    FOREIGN KEY (composer_id) REFERENCES composers(id) ON DELETE SET NULL,
    FOREIGN KEY (copyright_owner_id) REFERENCES copyright_owners(id) ON DELETE SET NULL
);
INSERT INTO songs_new (id, title, slug, artist_id, composer_id, copyright_owner_id, category, lyrics, views, created_at, updated_at)
    SELECT id, title, slug, artist_id, composer_id, copyright_owner_id, category, lyrics, views, created_at, created_at FROM songs;
DROP TABLE songs;
ALTER TABLE songs_new RENAME TO songs;

CREATE INDEX IF NOT EXISTS idx_songs_slug              ON songs(slug);
CREATE INDEX IF NOT EXISTS idx_songs_title              ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_category           ON songs(category);
CREATE INDEX IF NOT EXISTS idx_songs_views              ON songs(views DESC);
CREATE INDEX IF NOT EXISTS idx_songs_artist_id          ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_songs_composer_id        ON songs(composer_id);
CREATE INDEX IF NOT EXISTS idx_songs_copyright_owner_id ON songs(copyright_owner_id);
CREATE INDEX IF NOT EXISTS idx_songs_created_at         ON songs(created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_songs_updated_at
AFTER UPDATE ON songs
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE songs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ── reports: rebuild to link to songs, add updated_at + status CHECK ──
CREATE TABLE reports_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id         INTEGER,
    song_slug       TEXT,
    song_title      TEXT,
    song_artist     TEXT,
    reporter_name   TEXT NOT NULL,
    reporter_email  TEXT NOT NULL,
    body            TEXT NOT NULL,
    status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE SET NULL
);
INSERT INTO reports_new (id, song_id, song_slug, song_title, song_artist, reporter_name, reporter_email, body, status, created_at, updated_at)
    SELECT r.id, s.id, r.song_slug, r.song_title, r.song_artist, r.reporter_name, r.reporter_email, r.body, r.status, r.created_at, r.created_at
    FROM reports r
    LEFT JOIN songs s ON s.slug = r.song_slug;
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;

CREATE INDEX IF NOT EXISTS idx_reports_status  ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_song_id ON reports(song_id);

CREATE TRIGGER IF NOT EXISTS trg_reports_updated_at
AFTER UPDATE ON reports
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE reports SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ── contacts: rebuild to add updated_at + status CHECK ──
CREATE TABLE contacts_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    subject    TEXT DEFAULT 'General',
    message    TEXT NOT NULL,
    status     TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO contacts_new (id, name, email, subject, message, status, created_at, updated_at)
    SELECT id, name, email, subject, message, status, created_at, created_at FROM contacts;
DROP TABLE contacts;
ALTER TABLE contacts_new RENAME TO contacts;

CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);

CREATE TRIGGER IF NOT EXISTS trg_contacts_updated_at
AFTER UPDATE ON contacts
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE contacts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ── Full-text search over songs (title + lyrics), kept in sync via triggers ──
CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
    title,
    lyrics,
    content = 'songs',
    content_rowid = 'id'
);

INSERT INTO songs_fts (rowid, title, lyrics) SELECT id, title, lyrics FROM songs;

CREATE TRIGGER IF NOT EXISTS trg_songs_fts_insert
AFTER INSERT ON songs
BEGIN
    INSERT INTO songs_fts (rowid, title, lyrics) VALUES (NEW.id, NEW.title, NEW.lyrics);
END;

CREATE TRIGGER IF NOT EXISTS trg_songs_fts_delete
AFTER DELETE ON songs
BEGIN
    INSERT INTO songs_fts (songs_fts, rowid, title, lyrics) VALUES ('delete', OLD.id, OLD.title, OLD.lyrics);
END;

CREATE TRIGGER IF NOT EXISTS trg_songs_fts_update
AFTER UPDATE ON songs
FOR EACH ROW WHEN NEW.title IS NOT OLD.title OR NEW.lyrics IS NOT OLD.lyrics
BEGIN
    INSERT INTO songs_fts (songs_fts, rowid, title, lyrics) VALUES ('delete', OLD.id, OLD.title, OLD.lyrics);
    INSERT INTO songs_fts (rowid, title, lyrics) VALUES (NEW.id, NEW.title, NEW.lyrics);
END;

PRAGMA foreign_keys = ON;
