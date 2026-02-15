-- ╔══════════════════════════════════════════════════════════════╗
-- ║           MaraLyrics — Cloudflare D1 Schema                ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Drop existing tables to ensure clean schema migration
DROP TABLE IF EXISTS songs;
DROP TABLE IF EXISTS composers;
DROP TABLE IF EXISTS artists;

-- Artists table
CREATE TABLE IF NOT EXISTS artists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    bio         TEXT,
    image_url   TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Composers table
CREATE TABLE IF NOT EXISTS composers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    bio         TEXT,
    image_url   TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Songs table
CREATE TABLE IF NOT EXISTS songs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    artist_id   INTEGER,
    composer_id INTEGER,
    category    TEXT,
    lyrics      TEXT NOT NULL,
    views       INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL,
    FOREIGN KEY (composer_id) REFERENCES composers(id) ON DELETE SET NULL
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_songs_slug       ON songs(slug);
CREATE INDEX IF NOT EXISTS idx_songs_title      ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_category   ON songs(category);
CREATE INDEX IF NOT EXISTS idx_songs_views      ON songs(views DESC);
CREATE INDEX IF NOT EXISTS idx_songs_artist_id  ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_songs_composer_id ON songs(composer_id);
CREATE INDEX IF NOT EXISTS idx_artists_slug     ON artists(slug);
CREATE INDEX IF NOT EXISTS idx_composers_slug   ON composers(slug);

-- ╔══════════════════════════════════════════════════════════════╗
-- ║                    Sample Seed Data                         ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Seed artists
INSERT INTO artists (name, slug, bio) VALUES
('Mara Artist',         'mara-artist',         'A renowned Mara vocalist known for traditional melodies.'),
('Mara Singer',         'mara-singer',         'A gifted singer from the Mara community.'),
('Mara Choir',          'mara-choir',          'An acclaimed Mara choral group performing hymns and patriotic songs.'),
('Traditional Singers', 'traditional-singers', 'A collective preserving Mara traditional music.'),
('Youth Choir',         'youth-choir',         'A vibrant youth choir from the Mara community.');

-- Seed composers
INSERT INTO composers (name, slug, bio) VALUES
('Mara Composer',       'mara-composer',       'A prolific composer of Mara traditional and contemporary songs.');

-- Seed songs (linked by artist_id / composer_id)
INSERT INTO songs (title, slug, artist_id, composer_id, category, lyrics) VALUES
(
    'Mara Hlasak',
    'mara-hlasak',
    1, 1,
    'Traditional',
    'Line 1 of Mara Hlasak lyrics...' || char(10) || 'Line 2 of the song...' || char(10) || 'Line 3 continues here...' || char(10) || char(10) || 'Verse 2:' || char(10) || 'More lyrics follow...' || char(10) || 'Beautiful melody...'
),
(
    'Ka Lunglen',
    'ka-lunglen',
    2, NULL,
    'Love',
    'Ka lunglen a nasa e...' || char(10) || 'Heartfelt words flow...' || char(10) || 'Melody of the hills...' || char(10) || char(10) || 'Chorus:' || char(10) || 'Singing together...' || char(10) || 'Voices of Mara...'
),
(
    'Thla Thar Hla',
    'thla-thar-hla',
    3, 1,
    'Patriotic',
    'Thla thar a lo thleng ta...' || char(10) || 'New season dawns...' || char(10) || 'Gratitude fills the heart...' || char(10) || char(10) || 'Verse 2:' || char(10) || 'Joyful celebration...' || char(10) || 'Together we sing...'
),
(
    'Mara Ram Hla',
    'mara-ram-hla',
    4, NULL,
    'Traditional',
    'Mara ram chu a ngai...' || char(10) || 'Our homeland forever...' || char(10) || 'Mountains and valleys...' || char(10) || char(10) || 'Chorus:' || char(10) || 'Mara ram, Mara ram...' || char(10) || 'Beautiful land of ours...'
),
(
    'Rawl Tha Ei',
    'rawl-tha-ei',
    5, 1,
    'Gospel',
    'Rawl tha ei a that e...' || char(10) || 'Goodness overflows...' || char(10) || 'Blessing upon blessing...' || char(10) || char(10) || 'Bridge:' || char(10) || 'Forever grateful...' || char(10) || 'Songs of praise...'
);
