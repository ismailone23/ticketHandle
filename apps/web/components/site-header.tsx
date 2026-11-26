"use client";

import Link from "next/link";
import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const { user, loading, signOut } = useSession();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
        <Link
          href="/"
          className="font-mono text-sm font-semibold tracking-tight"
        >
          TicketHandle
        </Link>
        {loading ? null : user ? (
          <div className="flex items-center gap-3">
            <span className="hidden truncate text-sm text-muted-foreground sm:inline">
              {user.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/sign-in" />}
            nativeButton={false}
          >
            Sign in
          </Button>
        )}
      </div>
    </header>
  );
}
