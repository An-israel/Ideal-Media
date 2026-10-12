import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/database.types";

type TableName = keyof Database["public"]["Tables"];

/**
 * Checks whether the migrations a feature needs have actually been run.
 *
 * Features ship as code plus SQL, and the SQL is applied by hand in the
 * Supabase dashboard. When it has not been, every query touching a new column
 * fails and the page dies with a generic "Application error" — which says
 * nothing about the cause and looks identical to a deployment that never
 * happened. That has cost real time on this project more than once.
 *
 * So each page that depends on a migration asks first, and says plainly which
 * file to run instead of crashing.
 */

export interface MigrationNeed {
  /** The migration file to run, e.g. "0015_member_access.sql". */
  file: string;
  /** What stops working without it. */
  feature: string;
}

async function columnExists(table: TableName, column: string): Promise<boolean> {
  const admin = createAdminClient();
  // `limit(0)` asks PostgREST to validate the column without reading rows.
  // The column name is not in the generated types by definition — that is what
  // is being tested — so the select is cast rather than type-checked.
  const { error } = await (
    admin.from(table).select as unknown as (
      c: string
    ) => { limit: (n: number) => PromiseLike<{ error: { message: string } | null }> }
  )(column).limit(0);
  if (!error) return true;
  // A missing column is reported as an undefined-column error; anything else
  // (network, permissions) is not a migration problem, so do not blame one.
  return !/does not exist|could not find|unknown column/i.test(error.message);
}

/** Migrations the attendance feature depends on. */
export async function attendanceMigrations(): Promise<MigrationNeed[]> {
  const needs: MigrationNeed[] = [];
  if (!(await columnExists("attendance_records", "absence_reason"))) {
    needs.push({
      file: "0014_attendance_reporting.sql",
      feature: "weekly attendance reporting",
    });
  }
  return needs;
}

/** Migrations the members-list and subunit tools depend on. */
export async function memberAccessMigrations(): Promise<MigrationNeed[]> {
  const needs: MigrationNeed[] = [];
  if (!(await columnExists("profiles", "access_revoked_at"))) {
    needs.push({
      file: "0015_member_access.sql",
      feature: "removing and restoring member access",
    });
  }
  return needs;
}
