import "server-only";
import { getSessionRoles, type SessionRoles } from "@/lib/auth";

/**
 * Who may manage and report on General Training.
 *
 * These lived in the training actions file, and every export of a "use server"
 * file is a callable endpoint — so two permission helpers were being published
 * as actions anyone signed in could invoke. They are plain server functions
 * here, which is all they ever needed to be.
 */

async function requireUser(): Promise<SessionRoles> {
  const session = await getSessionRoles();
  if (!session) throw new Error("Not authenticated");
  if (session.accessRevoked) throw new Error("Your access has been removed.");
  return session;
}

/** Super admin or secretary may add, edit and publish teachings. */
export async function requireTrainingManager(): Promise<SessionRoles> {
  const session = await requireUser();
  if (!session.roles.includes("super_admin") && !session.roles.includes("secretary")) {
    throw new Error("Only a super admin or secretary can manage the training library.");
  }
  return session;
}

/**
 * Who may see the listen report, and over which members.
 *
 * Super admins and secretaries see the whole department. A subunit leader sees
 * only their own subunits' members — which is what `subunitIds` narrows.
 */
export async function requireTrainingReportAccess(): Promise<{
  session: SessionRoles;
  subunitIds?: string[];
}> {
  const session = await requireUser();
  if (session.roles.includes("super_admin") || session.roles.includes("secretary")) {
    return { session };
  }
  if (session.ledSubunitIds.length > 0) {
    return { session, subunitIds: session.ledSubunitIds };
  }
  throw new Error("You don't have access to the training report.");
}
