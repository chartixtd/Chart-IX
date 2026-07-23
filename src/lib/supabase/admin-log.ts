import { createServiceRoleClient } from "./middleware";

interface LogEntry {
  adminId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
}

/**
 * Write an audit log entry to the admin_logs table.
 * Uses service_role to bypass RLS (the admin_logs table is not writable by the client).
 */
export async function logAdminAction(entry: LogEntry) {
  try {
    const client = createServiceRoleClient();
    await client.from("admin_logs").insert({
      admin_id: entry.adminId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      old_value: entry.oldValue ?? null,
      new_value: entry.newValue ?? null,
      ip_address: entry.ipAddress ?? null,
    });
  } catch {
    // Logging failure should never break the main operation
  }
}
