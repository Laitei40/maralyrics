-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Migration 0017 — phone number for artist / composer accounts ║
-- ║  Claiming a profile is a real-identity step, so the review    ║
-- ║  team needs an email AND a phone number to reach the claimant.║
-- ║  Only admins ever see it. Additive only.                      ║
-- ╚══════════════════════════════════════════════════════════════╝

ALTER TABLE person_accounts ADD COLUMN contact_phone TEXT;
