import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { LearnerSignupForm } from "./signup-form";

export const metadata = { title: "Join the Skills Academy — Ideal Media" };

export default function LearnerSignupPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <header className="flex items-center justify-between p-6">
        <Wordmark />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <LearnerSignupForm />
        </div>
      </main>
    </div>
  );
}
