import { createClient } from "@/lib/supabase/server";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const supabase = await createClient();
  const { data: subunits } = await supabase
    .from("subunits")
    .select("id, name, category")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  const primary = (subunits ?? []).filter((s) => s.category === "primary");
  const secondary = (subunits ?? []).filter((s) => s.category === "secondary");

  return <SignupForm primary={primary} secondary={secondary} />;
}
