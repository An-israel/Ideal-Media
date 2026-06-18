import { redirect } from "next/navigation";

// No landing page (Section 0): authenticated users land on the dashboard,
// everyone else is bounced to /login by middleware.
export default function Home() {
  redirect("/dashboard");
}
