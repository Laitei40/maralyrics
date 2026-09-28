-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0008 — Login attempt lockout                        ║
-- ║  Adds login_attempts, checked before the password comparison   ║
-- ║  in POST /auth/login to lock an account out after too many     ║
-- ║  failed attempts in a short window (brute-force protection).   ║
-- ║  Additive only — no data is dropped.                           ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS login_attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_username_created ON login_attempts(username, created_at);
