-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0004 — Role matrix, song revisions, audit log       ║
-- ║  Widens admin_users.role from 3 values (super_admin/editor/    ║
-- ║  moderator) to 6 (viewer/translator/reviewer/editor/manager/   ║
-- ║  super_admin); moderator accounts become reviewer. Adds        ║
-- ║  songs.status (pending/published/archived, existing rows       ║
-- ║  backfilled to published). Adds song_revisions (review queue   ║
-- ║  for direct edits) and audit_log (accountability trail).       ║
-- ║  Additive only — no data is dropped.                           ║
-- ╚══════════════════════════════════════════════════════════════╝

PRAGMA foreign_keys = OFF;

-- ── admin_users: widen role CHECK to 6 values, moderator -> reviewer ──
CREATE TABLE admin_users_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('viewer', 'translator', 'reviewer', 'editor', 'manager', 'super_admin')),
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO admin_users_new (id, username, password_hash, role, created_at, updated_at)
    SELECT id, username, password_hash, CASE role WHEN 'moderator' THEN 'reviewer' ELSE role END, created_at, updated_at
    FROM admin_users;
DROP TABLE admin_users;
ALTER TABLE admin_users_new RENAME TO admin_users;

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);

CREATE TRIGGER IF NOT EXISTS trg_admin_users_updated_at
AFTER UPDATE ON admin_users
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE admin_users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ── songs: add status (pending/published/archived), existing rows -> published ──
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
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'archived')),
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL,
    FOREIGN KEY (composer_id) REFERENCES composers(id) ON DELETE SET NULL,
    FOREIGN KEY (copyright_owner_id) REFERENCES copyright_owners(id) ON DELETE SET NULL
);
INSERT INTO songs_new (id, title, slug, artist_id, composer_id, copyright_owner_id, category, lyrics, views, status, created_at, updated_at)
    SELECT id, title, slug, artist_id, composer_id, copyright_owner_id, category, lyrics, views, 'published', created_at, updated_at
    FROM songs;
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
CREATE INDEX IF NOT EXISTS idx_songs_status             ON songs(status);

CREATE TRIGGER IF NOT EXISTS trg_songs_updated_at
AFTER UPDATE ON songs
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE songs SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- songs_fts's sync triggers are dropped along with the songs table above and
-- must be explicitly recreated (they are not IF-NOT-EXISTS no-ops here).
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

-- ── song_revisions: review queue for direct song-content edits ──
CREATE TABLE IF NOT EXISTS song_revisions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id             INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    slug                TEXT NOT NULL,
    lyrics              TEXT NOT NULL,
    category            TEXT CHECK (category IS NULL OR category IN ('Gospel', 'Love', 'Traditional', 'Patriotic')),
    copyright_owner_id  INTEGER REFERENCES copyright_owners(id) ON DELETE SET NULL,
    artist_ids          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(artist_ids)),
    composer_ids        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(composer_ids)),
    submitted_by        INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewer_id         INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    reviewer_note       TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at         DATETIME
);

CREATE INDEX IF NOT EXISTS idx_song_revisions_song_id      ON song_revisions(song_id);
CREATE INDEX IF NOT EXISTS idx_song_revisions_status       ON song_revisions(status);
CREATE INDEX IF NOT EXISTS idx_song_revisions_submitted_by ON song_revisions(submitted_by);

-- ── audit_log: accountability trail for meaningful admin mutations ──
CREATE TABLE IF NOT EXISTS audit_log (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id       INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    admin_username TEXT NOT NULL,
    action         TEXT NOT NULL,
    target_type    TEXT NOT NULL,
    target_id      INTEGER,
    detail         TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target     ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin_id   ON audit_log(admin_id);
