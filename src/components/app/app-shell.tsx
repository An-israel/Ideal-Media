"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, Bell, LogOut } from "lucide-react";
import type { Role } from "@/lib/constants";
import { Nav } from "@/components/app/nav";
import { Guide } from "@/components/app/guide";
import { BackButton } from "@/components/app/back-button";
import { Wordmark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/(app)/actions";

export function AppShell({
  roles,
  fullName,
  unreadCount,
  children,
}: {
  roles: Role[];
  fullName: string;
  unreadCount: number;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[var(--bg)]">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-4 md:flex">
        <div className="px-2 py-3">
          <Wordmark />
        </div>
        <div className="mt-4 flex-1">
          <Nav roles={roles} />
        </div>
        <SignOutButton />
      </aside>

      {/* Mobile slide-over */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between px-2 py-2">
              <Wordmark />
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="mt-4 flex-1">
              <Nav roles={roles} onNavigate={() => setMobileOpen(false)} />
            </div>
            <SignOutButton />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)]/80 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <BackButton />
          </div>
          <div className="flex items-center gap-1">
            <Link href="/notifications" className="relative">
              <Button variant="ghost" size="icon" aria-label="Notifications">
                <Bell className="h-[1.15rem] w-[1.15rem]" />
              </Button>
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
            <ThemeToggle />
            <span className="ml-2 hidden text-sm font-medium sm:inline">{fullName}</span>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>

      <Guide roles={roles} />
    </div>
  );
}

function SignOutButton() {
  return (
    <form action={signOut} className="pt-2">
      <Button variant="ghost" className="w-full justify-start text-[var(--text-muted)]" type="submit">
        <LogOut className="h-[1.1rem] w-[1.1rem]" />
        Sign out
      </Button>
    </form>
  );
}
