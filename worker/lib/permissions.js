/**
 * Central role/permission matrix for the 6-role admin model. Route files
 * import named lists here instead of typing `requireRole('a','b')` ad hoc,
 * so the matrix lives in exactly one place.
 *
 * Keep in sync with public/admin/index.js's ROLE_TABS (the frontend can't
 * import this file directly — index.js is a plain <script>, not a module).
 */

export const ROLES = ['viewer', 'translator', 'reviewer', 'editor', 'manager', 'super_admin'];

// Song lifecycle
export const CAN_CREATE_SONG      = ['translator', 'editor', 'manager', 'super_admin'];
export const CAN_EDIT_SONG_DIRECT = ['editor', 'manager', 'super_admin'];
export const CAN_SUBMIT_REVISION  = ['translator', 'editor', 'manager', 'super_admin'];
export const CAN_REVIEW_REVISIONS = ['reviewer', 'manager', 'super_admin'];
export const CAN_PUBLISH_UNPUBLISH = ['reviewer', 'editor', 'manager', 'super_admin'];
export const CAN_ARCHIVE_RESTORE   = ['reviewer', 'manager', 'super_admin']; // editor excluded
export const CAN_DELETE_SONG       = ['manager', 'super_admin'];

// Reference data (artists / composers / copyright owners) — read is all 6 roles, write is narrower
export const CAN_MANAGE_REFERENCE_DATA = ['manager', 'super_admin'];

// Admin accounts
export const CAN_VIEW_ADMIN_USERS   = ['manager', 'super_admin'];
export const CAN_MANAGE_ADMIN_USERS = ['manager', 'super_admin'];

// Reports ("Feedback") / Contacts ("Feedback Inbox") / Audit log
export const CAN_MANAGE_REPORTS  = ['translator', 'reviewer', 'editor', 'manager', 'super_admin']; // everyone but viewer
export const CAN_MANAGE_CONTACTS = ['super_admin'];
export const CAN_VIEW_AUDIT_LOG  = ['reviewer', 'manager', 'super_admin'];

export const canGrantSuperAdmin = (role) => role === 'super_admin';

/** Which permission list governs a songs.status transition, based on whether archive/restore is involved. */
export function statusChangePermission(fromStatus, toStatus) {
  return fromStatus === 'archived' || toStatus === 'archived' ? CAN_ARCHIVE_RESTORE : CAN_PUBLISH_UNPUBLISH;
}
