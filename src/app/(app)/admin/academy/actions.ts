"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { getSessionRoles } from "@/lib/auth";
import { importAcademy, type ImportResult } from "@/lib/academy-import";

export async function runAcademyImport(): Promise<ImportResult> {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not signed in.");
  // The import writes with the service-role client, so the role check has to
  // happen here — RLS will not catch it.
  if (!session.roles.includes("super_admin")) notFound();

  const result = await importAcademy();
  revalidatePath("/academy", "layout");
  revalidatePath("/admin/academy");
  return result;
}
