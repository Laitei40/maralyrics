-- ╔══════════════════════════════════════════════════════════════╗
-- ║           MaraLyrics — Cloudflare D1 Schema                 ║
-- ╚══════════════════════════════════════════════════════════════╝
--
-- This file defines the CURRENT desired schema and is safe to run
-- against any database, new or existing — every statement is
-- idempotent (IF NOT EXISTS) and nothing is ever dropped.
--
-- • Bootstrapping a brand new database? Just run this file.
-- • Upgrading an existing database created before a given schema
--   change? Run the matching file in ./migrations first — this file
--   alone will NOT retroactively alter tables that already exist
--   under an older definition.
-- • Want sample data for local development? See ./seed.sql.

-- Artists table
CREATE TABLE IF NOT EXISTS artists (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    slug         TEXT UNIQUE NOT NULL,
    bio          TEXT,
    image_url    TEXT,
    social_links TEXT CHECK (social_links IS NULL OR json_valid(social_links)),
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Composers table
CREATE TABLE IF NOT EXISTS composers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    slug         TEXT UNIQUE NOT NULL,
    bio          TEXT,
    image_url    TEXT,
    social_links TEXT CHECK (social_links IS NULL OR json_valid(social_links)),
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Copyright Owners table (international standard fields)
CREATE TABLE IF NOT EXISTS copyright_owners (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    full_legal_name TEXT,
    organization    TEXT,
    territory       TEXT,
    email           TEXT,
    website         TEXT,
    address         TEXT,
    ipi_number      TEXT,
    isrc_prefix     TEXT,
    pro_affiliation TEXT,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Songs table
CREATE TABLE IF NOT EXISTS songs (
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

-- Reports table (copyright / content reports filed against a song)
CREATE TABLE IF NOT EXISTS reports (
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

-- Contact form submissions
CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    subject    TEXT DEFAULT 'General',
    message    TEXT NOT NULL,
    status     TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin accounts (role-based: super_admin manages other admins, editor manages
-- content, moderator handles reports/contacts) — replaces the single shared
-- ADMIN_TOKEN bearer secret with per-user login + JWT sessions.
CREATE TABLE IF NOT EXISTS admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('super_admin', 'editor', 'moderator')),
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Multi-artist / multi-composer credits (a song can have more than one of
-- each, capped at 20 in the API). songs.artist_id / composer_id remain as
-- the primary (first) credited person for backward compatibility.
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

-- ── Performance indexes ──
CREATE INDEX IF NOT EXISTS idx_songs_slug              ON songs(slug);
CREATE INDEX IF NOT EXISTS idx_songs_title              ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_category           ON songs(category);
CREATE INDEX IF NOT EXISTS idx_songs_views              ON songs(views DESC);
CREATE INDEX IF NOT EXISTS idx_songs_artist_id          ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_songs_composer_id        ON songs(composer_id);
CREATE INDEX IF NOT EXISTS idx_songs_copyright_owner_id ON songs(copyright_owner_id);
CREATE INDEX IF NOT EXISTS idx_songs_created_at         ON songs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artists_slug             ON artists(slug);
CREATE INDEX IF NOT EXISTS idx_composers_slug           ON composers(slug);
CREATE INDEX IF NOT EXISTS idx_copyright_owners_slug    ON copyright_owners(slug);
CREATE INDEX IF NOT EXISTS idx_reports_status           ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_song_id          ON reports(song_id);
CREATE INDEX IF NOT EXISTS idx_contacts_status          ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_admin_users_username     ON admin_users(username);
CREATE INDEX IF NOT EXISTS idx_song_artists_artist_id   ON song_artists(artist_id);
CREATE INDEX IF NOT EXISTS idx_song_composers_composer_id ON song_composers(composer_id);

-- ── updated_at auto-maintenance triggers ──
CREATE TRIGGER IF NOT EXISTS trg_artists_updated_at
AFTER UPDATE ON artists
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE artists SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_composers_updated_at
AFTER UPDATE ON composers
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE composers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_copyright_owners_updated_at
AFTER UPDATE ON copyright_owners
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE copyright_owners SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_songs_updated_at
AFTER UPDATE ON songs
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE songs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_reports_updated_at
AFTER UPDATE ON reports
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE reports SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_contacts_updated_at
AFTER UPDATE ON contacts
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE contacts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_admin_users_updated_at
AFTER UPDATE ON admin_users
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE admin_users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ── Full-text search over songs (title + lyrics) ──
CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
    title,
    lyrics,
    content = 'songs',
    content_rowid = 'id'
);

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
