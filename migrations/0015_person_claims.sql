-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0015 — Claim your profile                          ║
-- ║  Artists and composers get their own accounts (separate from  ║
-- ║  admin_users — they can never reach the admin dashboard) and  ║
-- ║  can claim a profile. A claim is 'pending' until a Manager or ║
-- ║  Super Admin reviews it; only an 'approved' claim lets the    ║
-- ║  account edit that profile's bio, photo and social links.     ║
-- ║  Additive only.                                               ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS person_accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    contact_email TEXT,   -- only the review team sees it (never returned by the public API)
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS person_claims (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL REFERENCES person_accounts(id) ON DELETE CASCADE,
    artist_id   INTEGER REFERENCES artists(id) ON DELETE CASCADE,
    composer_id INTEGER REFERENCES composers(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
    evidence    TEXT NOT NULL,   -- how the claimant says we can verify them
    review_note TEXT,            -- shown to the claimant
    reviewed_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    reviewed_at DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK ((artist_id IS NOT NULL AND composer_id IS NULL) OR (artist_id IS NULL AND composer_id IS NOT NULL))
);

-- A profile has at most one owner (approved claim) ...
CREATE UNIQUE INDEX IF NOT EXISTS uq_claim_artist_owner   ON person_claims(artist_id)   WHERE status = 'approved' AND artist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_claim_composer_owner ON person_claims(composer_id) WHERE status = 'approved' AND composer_id IS NOT NULL;
-- ... and an account has at most one open (pending/approved) claim per profile.
CREATE UNIQUE INDEX IF NOT EXISTS uq_claim_artist_open   ON person_claims(account_id, artist_id)   WHERE status IN ('pending', 'approved') AND artist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_claim_composer_open ON person_claims(account_id, composer_id) WHERE status IN ('pending', 'approved') AND composer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_claims_status ON person_claims(status, created_at);
