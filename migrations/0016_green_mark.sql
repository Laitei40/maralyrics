-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0016 — Green mark                                  ║
-- ║  A paid "Green mark" (like a verified tick) for artists and   ║
-- ║  composers who own their profile. Plans of 1 / 3 / 6 / 12 /   ║
-- ║  36 months with prices set by the Super Admin. Every purchase ║
-- ║  is an ORDER that a Super Admin reviews by hand before the    ║
-- ║  mark is switched on (money is involved, so nothing is        ║
-- ║  automatic). Additive only.                                   ║
-- ╚══════════════════════════════════════════════════════════════╝

-- Plans: a plan is only offered once it has a price AND is enabled.
CREATE TABLE IF NOT EXISTS green_plans (
    months      INTEGER PRIMARY KEY CHECK (months IN (1, 3, 6, 12, 36)),
    price_cents INTEGER CHECK (price_cents IS NULL OR (price_cents > 0 AND price_cents <= 100000000)),
    enabled     INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
);
INSERT OR IGNORE INTO green_plans (months) VALUES (1), (3), (6), (12), (36);

-- One row of settings: the price currency and the how-to-pay text shown to buyers.
CREATE TABLE IF NOT EXISTS green_settings (
    id                   INTEGER PRIMARY KEY CHECK (id = 1),
    currency             TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
    payment_instructions TEXT
);
INSERT OR IGNORE INTO green_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS green_orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id   INTEGER NOT NULL REFERENCES person_accounts(id) ON DELETE CASCADE,
    artist_id    INTEGER REFERENCES artists(id) ON DELETE CASCADE,
    composer_id  INTEGER REFERENCES composers(id) ON DELETE CASCADE,
    months       INTEGER NOT NULL CHECK (months IN (1, 3, 6, 12, 36)),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),   -- the price at the time of ordering
    currency     TEXT NOT NULL,
    method       TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'card')),
    reference    TEXT NOT NULL,   -- the buyer's payment reference / transaction id
    note         TEXT,
    receipt      TEXT,            -- optional receipt image (data:image URL), only the reviewer sees it
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    review_note  TEXT,
    reviewed_by  INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
    reviewed_at  DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK ((artist_id IS NOT NULL AND composer_id IS NULL) OR (artist_id IS NULL AND composer_id IS NOT NULL))
);
-- At most one open (pending) order per profile.
CREATE UNIQUE INDEX IF NOT EXISTS uq_green_order_open_artist   ON green_orders(artist_id)   WHERE status = 'pending' AND artist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_green_order_open_composer ON green_orders(composer_id) WHERE status = 'pending' AND composer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_green_orders_status ON green_orders(status, created_at);

-- The mark itself: a profile has it while expires_at is in the future. Buying more time extends it.
CREATE TABLE IF NOT EXISTS green_marks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_id   INTEGER UNIQUE REFERENCES artists(id) ON DELETE CASCADE,
    composer_id INTEGER UNIQUE REFERENCES composers(id) ON DELETE CASCADE,
    expires_at  DATETIME NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK ((artist_id IS NOT NULL AND composer_id IS NULL) OR (artist_id IS NULL AND composer_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_green_marks_expires ON green_marks(expires_at);
