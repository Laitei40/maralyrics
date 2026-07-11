/** Records one row in audit_log. Called after a mutation succeeds — never blocks/fails the response. */
export async function logAudit(db, admin, action, targetType, targetId, detail) {
  await db
    .prepare(
      `INSERT INTO audit_log (admin_id, admin_username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(admin.sub, admin.username, action, targetType, targetId ?? null, detail ?? null)
    .run();
}
