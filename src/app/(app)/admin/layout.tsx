import { AdminNav } from "@/components/app/admin-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Admin</h1>
      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Full control: roles, subunits, activities, code of conduct, and analytics.
      </p>
      <AdminNav />
      {children}
    </div>
  );
}
