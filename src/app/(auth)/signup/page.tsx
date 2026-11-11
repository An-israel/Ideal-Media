import { createClient } from "@/lib/supabase/server";
import { resolveClaimInvite } from "@/lib/claim-invite";
import { SignupForm } from "./signup-form";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>;
}) {
  const supabase = await createClient();
  const { data: subunits } = await supabase
    .from("subunits")
    .select("id, name, category")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  const primary = (subunits ?? []).filter((s) => s.category === "primary");
  const secondary = (subunits ?? []).filter((s) => s.category === "secondary");

  // A claim link from the secretary: check it now, so somebody holding a dead
  // one is told before they fill the whole form in. A failure to check (the
  // migration not run yet, say) must not take ordinary sign-up down with it.
  const { claim } = await searchParams;
  let invite: { token: string; fullName: string } | null = null;
  let inviteProblem = false;
  if (claim) {
    try {
      const target = await resolveClaimInvite(claim);
      if (target) invite = { token: claim, fullName: target.fullName };
      else inviteProblem = true;
    } catch {
      inviteProblem = true;
    }
  }

  return (
    <SignupForm
      primary={primary}
      secondary={secondary}
      invite={invite}
      inviteProblem={inviteProblem}
    />
  );
}
