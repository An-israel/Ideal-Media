"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  GraduationCap,
  Users,
  ClipboardList,
  HeartHandshake,
  Shield,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[]; // visible only if the user holds one of these (member items: undefined)
}

const ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/courses", label: "My Courses", icon: GraduationCap },
  { href: "/leader", label: "Leader", icon: Users, roles: ["subunit_leader", "super_admin"] },
  { href: "/secretary", label: "Secretary", icon: ClipboardList, roles: ["secretary", "super_admin"] },
  { href: "/welfare", label: "Welfare", icon: HeartHandshake, roles: ["welfare", "super_admin"] },
  { href: "/admin", label: "Admin", icon: Shield, roles: ["super_admin"] },
];

export function Nav({ roles, onNavigate }: { roles: Role[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const visible = ITEMS.filter((i) => !i.roles || i.roles.some((r) => roles.includes(r)));

  return (
    <nav className="flex flex-col gap-1">
      {visible.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:bg-[var(--border)]/40 hover:text-[var(--text)]"
            )}
          >
            <Icon className="h-[1.1rem] w-[1.1rem]" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
