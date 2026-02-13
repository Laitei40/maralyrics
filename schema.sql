-- ╔══════════════════════════════════════════════════════════════╗
-- ║           MaraLyrics — Cloudflare D1 Schema                ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Songs table
CREATE TABLE IF NOT EXISTS songs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    artist      TEXT,
    category    TEXT,
    lyrics      TEXT NOT NULL,
    views       INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_slug     ON songs(slug);
CREATE INDEX IF NOT EXISTS idx_title    ON songs(title);
CREATE INDEX IF NOT EXISTS idx_category ON songs(category);
CREATE INDEX IF NOT EXISTS idx_views    ON songs(views DESC);
CREATE INDEX IF NOT EXISTS idx_artist   ON songs(artist);

-- ╔══════════════════════════════════════════════════════════════╗
-- ║                    Sample Seed Data                         ║
-- ╚══════════════════════════════════════════════════════════════╝

INSERT INTO songs (title, slug, artist, category, lyrics) VALUES
(
    'Mara Hlasak',
    'mara-hlasak',
    'Mara Artist',
    'Traditional',
    'Line 1 of Mara Hlasak lyrics...' || char(10) || 'Line 2 of the song...' || char(10) || 'Line 3 continues here...' || char(10) || char(10) || 'Verse 2:' || char(10) || 'More lyrics follow...' || char(10) || 'Beautiful melody...'
),
(
    'Ka Lunglen',
    'ka-lunglen',
    'Mara Singer',
    'Modern',
    'Ka lunglen a nasa e...' || char(10) || 'Heartfelt words flow...' || char(10) || 'Melody of the hills...' || char(10) || char(10) || 'Chorus:' || char(10) || 'Singing together...' || char(10) || 'Voices of Mara...'
),
(
    'Thla Thar Hla',
    'thla-thar-hla',
    'Mara Choir',
    'Worship',
    'Thla thar a lo thleng ta...' || char(10) || 'New season dawns...' || char(10) || 'Gratitude fills the heart...' || char(10) || char(10) || 'Verse 2:' || char(10) || 'Joyful celebration...' || char(10) || 'Together we sing...'
),
(
    'Mara Ram Hla',
    'mara-ram-hla',
    'Traditional Singers',
    'Traditional',
    'Mara ram chu a ngai...' || char(10) || 'Our homeland forever...' || char(10) || 'Mountains and valleys...' || char(10) || char(10) || 'Chorus:' || char(10) || 'Mara ram, Mara ram...' || char(10) || 'Beautiful land of ours...'
),
(
    'Rawl Tha Ei',
    'rawl-tha-ei',
    'Youth Choir',
    'Gospel',
    'Rawl tha ei a that e...' || char(10) || 'Goodness overflows...' || char(10) || 'Blessing upon blessing...' || char(10) || char(10) || 'Bridge:' || char(10) || 'Forever grateful...' || char(10) || 'Songs of praise...'
);
