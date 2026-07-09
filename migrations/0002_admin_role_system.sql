-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0002 — Admin role system                           ║
-- ║  Adds: admin_users table backing multi-account, role-based    ║
-- ║  admin login (super_admin / editor / moderator), replacing    ║
-- ║  the single shared ADMIN_TOKEN bearer secret.                 ║
-- ║  Additive only — no data is dropped.                          ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('super_admin', 'editor', 'moderator')),
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);

CREATE TRIGGER IF NOT EXISTS trg_admin_users_updated_at
AFTER UPDATE ON admin_users
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE admin_users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
