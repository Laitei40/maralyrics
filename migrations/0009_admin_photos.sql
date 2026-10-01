-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0009 — Admin profile photos                        ║
-- ║  Adds admin_users.photo: a small (cropped, client-resized)    ║
-- ║  data:image URL an admin uploads for their own profile. When  ║
-- ║  NULL the UI falls back to the emoji avatar, then a default   ║
-- ║  icon. Additive only — no data is dropped.                    ║
-- ╚══════════════════════════════════════════════════════════════╝

ALTER TABLE admin_users ADD COLUMN photo TEXT;
