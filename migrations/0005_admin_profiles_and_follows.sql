-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0005 — Admin profiles and follows                  ║
-- ║  Adds admin_users.avatar (a built-in emoji identifier, chosen  ║
-- ║  from a fixed server-side whitelist — no image upload) and a   ║
-- ║  new admin_follows table so any admin can follow/unfollow any  ║
-- ║  other admin's profile. Additive only — no data is dropped.    ║
-- ╚══════════════════════════════════════════════════════════════╝

ALTER TABLE admin_users ADD COLUMN avatar TEXT;

CREATE TABLE IF NOT EXISTS admin_follows (
    follower_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    followed_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, followed_id),
    CHECK (follower_id != followed_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_follows_followed_id ON admin_follows(followed_id);
