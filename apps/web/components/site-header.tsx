"use client";

import Link from "next/link";
import { isAdmin, useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  const { user, loading, signOut } = useSession();

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight"
        >
          TicketHandle
        </Link>
        {loading ? null : user ? (
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" render={<Link href="/orders" />} nativeButton={false}>
              My bookings
            </Button>
            {isAdmin(user) ? (
              <Button variant="ghost" size="sm" render={<Link href="/admin" />} nativeButton={false}>
                Admin
              </Button>
            ) : null}
            <span className="hidden truncate text-sm text-muted-foreground sm:inline">
              {user.name || user.email}
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
