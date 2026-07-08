-- ╔══════════════════════════════════════════════════════════════╗
-- ║           MaraLyrics — Sample Seed Data (dev only)          ║
-- ╚══════════════════════════════════════════════════════════════╝
--
-- Sample data for local development / fresh environments only.
-- Never run this against the production database — it is additive
-- but not idempotent (re-running it will insert duplicate rows).

INSERT INTO artists (name, slug, bio) VALUES
('Mara Artist',         'mara-artist',         'A renowned Mara vocalist known for traditional melodies.'),
('Mara Singer',         'mara-singer',         'A gifted singer from the Mara community.'),
('Mara Choir',          'mara-choir',          'An acclaimed Mara choral group performing hymns and patriotic songs.'),
('Traditional Singers', 'traditional-singers', 'A collective preserving Mara traditional music.'),
('Youth Choir',         'youth-choir',         'A vibrant youth choir from the Mara community.');

INSERT INTO composers (name, slug, bio) VALUES
('Mara Composer', 'mara-composer', 'A prolific composer of Mara traditional and contemporary songs.');

INSERT INTO songs (title, slug, artist_id, composer_id, category, lyrics) VALUES
(
    'Mara Hlasa',
    'mara-hlasa',
    1, 1,
    'Traditional',
    'Line 1 of Mara Hlasa lyrics...' || char(10) || 'Line 2 of the song...' || char(10) || 'Line 3 continues here...' || char(10) || char(10) || 'Verse 2:' || char(10) || 'More lyrics follow...' || char(10) || 'Beautiful melody...'
),
(
    'Ei ly kaw',
    'ei-ly-kaw',
    2, NULL,
    'Love',
    'Ei ly kaw a nasa e...' || char(10) || 'Heartfelt words flow...' || char(10) || 'Melody of the hills...' || char(10) || char(10) || 'Chorus:' || char(10) || 'Singing together...' || char(10) || 'Voices of Mara...'
),
(
    'Thlahpa Pathaih',
    'thlahpa-pathaih',
    3, 1,
    'Patriotic',
    'Hla a pha ngaita...' || char(10) || 'New season dawns...' || char(10) || 'Gratitude fills the heart...' || char(10) || char(10) || 'Verse 2:' || char(10) || 'Joyful celebration...' || char(10) || 'Together we sing...'
),
(
    'Mara Râh Hla',
    'mara-râh-hla',
    4, NULL,
    'Traditional',
    'Mararâh chu a pha...' || char(10) || 'Our homeland forever...' || char(10) || 'Mountains and valleys...' || char(10) || char(10) || 'Chorus:' || char(10) || 'Mararâh, Mararâh...' || char(10) || 'Beautiful land of ours...'
),
(
    'Abeipa pha zie',
    'abeipa-pha-zie',
    5, 1,
    'Gospel',
    'Abeipa pha zie a that e...' || char(10) || 'Goodness overflows...' || char(10) || 'Blessing upon blessing...' || char(10) || char(10) || 'Bridge:' || char(10) || 'Forever grateful...' || char(10) || 'Songs of praise...'
);
