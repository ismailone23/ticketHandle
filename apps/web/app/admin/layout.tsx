import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { API_URL } from "@/lib/api";

// Server-side gate: non-admins get a plain 404, so the admin pages are never sent.
// The API also refuses them (403); this just keeps the screens private.
// shortcut: relies on the session cookie reaching this server (same host in dev); put web and API under one domain in production
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookie = (await headers()).get("cookie") ?? "";
  const res = await fetch(`${API_URL}/api/auth/get-session`, { headers: { cookie }, cache: "no-store" }).catch(() => null);
  const session = res?.ok ? ((await res.json()) as { user?: { role?: string | null } } | null) : null;
  if (!session?.user?.role?.split(",").includes("admin")) notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/admin" className="font-semibold">
          Admin
        </Link>
        <span className="text-muted-foreground">Trains and trips</span>
      </nav>
      {children}
    </div>
  );
}
