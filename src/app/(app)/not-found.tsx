import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shown inside the app shell when a page calls notFound() — a course that was
 * unpublished, a link to a subunit you do not lead, a certificate not yet
 * earned. Keeping the sidebar means the way out is one tap, not the browser's
 * back button.
 */
export default function AppNotFound() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <SearchX className="h-8 w-8 text-[var(--text-muted)]" />
        <h1 className="text-lg font-semibold">That page isn&apos;t here</h1>
        <p className="max-w-md text-sm text-[var(--text-muted)]">
          It may have been moved or removed, or it may not be something your account can open.
        </p>
        <Link href="/dashboard">
          <Button variant="outline">Back to the dashboard</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
