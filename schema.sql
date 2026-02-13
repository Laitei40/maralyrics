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
    'Line 1 of Mara Hlasak lyrics...\nLine 2 of the song...\nLine 3 continues here...\n\nVerse 2:\nMore lyrics follow...\nBeautiful melody...'
),
(
    'Ka Lunglen',
    'ka-lunglen',
    'Mara Singer',
    'Modern',
    'Ka lunglen a nasa e...\nHeartfelt words flow...\nMelody of the hills...\n\nChorus:\nSinging together...\nVoices of Mara...'
),
(
    'Thla Thar Hla',
    'thla-thar-hla',
    'Mara Choir',
    'Worship',
    'Thla thar a lo thleng ta...\nNew season dawns...\nGratitude fills the heart...\n\nVerse 2:\nJoyful celebration...\nTogether we sing...'
),
(
    'Mara Ram Hla',
    'mara-ram-hla',
    'Traditional Singers',
    'Traditional',
    'Mara ram chu a ngai...\nOur homeland forever...\nMountains and valleys...\n\nChorus:\nMara ram, Mara ram...\nBeautiful land of ours...'
),
(
    'Rawl Tha Ei',
    'rawl-tha-ei',
    'Youth Choir',
    'Gospel',
    'Rawl tha ei a that e...\nGoodness overflows...\nBlessing upon blessing...\n\nBridge:\nForever grateful...\nSongs of praise...'
);
