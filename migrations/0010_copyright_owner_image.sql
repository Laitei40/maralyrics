-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0010 — Copyright owner photo                       ║
-- ║  Adds copyright_owners.image_url (http(s) URL or a cropped    ║
-- ║  data:image URL), matching artists/composers. Additive only.  ║
-- ╚══════════════════════════════════════════════════════════════╝

ALTER TABLE copyright_owners ADD COLUMN image_url TEXT;
