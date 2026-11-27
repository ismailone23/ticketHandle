import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { API_URL } from "@/lib/api";

// Server-side gate: non-admins get a plain 404, so the admin pages are never sent.
// The API also refuses them (403); this just keeps the screens private.
// Needs the session cookie to reach this server: same host, or COOKIE_DOMAIN set on the API when web and API are sibling subdomains.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookie = (await headers()).get("cookie") ?? "";
  const res = await fetch(`${API_URL}/api/auth/get-session`, {
    headers: { cookie },
    cache: "no-store",
  }).catch(() => null);
  const session = res?.ok
    ? ((await res.json()) as { user?: { role?: string | null } } | null)
    : null;
  if (!session?.user?.role?.split(",").includes("admin")) notFound();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <AdminNav />
      {children}
    </div>
  );
}
