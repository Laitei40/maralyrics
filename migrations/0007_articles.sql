-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0007 — Articles                                     ║
-- ║  Adds the articles table backing the Developer Dashboard's     ║
-- ║  Articles tab and the public /articles page. Publishing an     ║
-- ║  article (draft -> published) is what makes it visible on the  ║
-- ║  public site and picked up by the site's in-app notification   ║
-- ║  poller (title + author) — there's no separate "send" step.    ║
-- ║  Additive only — no data is dropped.                           ║
-- ╚══════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS articles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    slug         TEXT UNIQUE NOT NULL,
    author_name  TEXT NOT NULL,
    summary      TEXT,
    content      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    published_at DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_articles_slug         ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_status        ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_created_at    ON articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_published_at  ON articles(published_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_articles_updated_at
AFTER UPDATE ON articles
FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
    UPDATE articles SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
