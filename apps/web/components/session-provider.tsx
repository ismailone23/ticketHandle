"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo } from "react";
import { ApiError, api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

type User = { id: string; name: string; email: string };
type SessionContext = {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
  // api() that sends signed-out users to sign-in and back here afterwards
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

const Ctx = createContext<SessionContext | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { data, isPending, refetch } = authClient.useSession();

  const request = useCallback(
    async <T,>(p: string, init?: RequestInit) => {
      try {
        return await api<T>(p, init);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.push(
            `/sign-in?next=${encodeURIComponent(path + location.search)}`,
          );
          return new Promise<T>(() => {}); // page is leaving; never settle
        }
        throw e;
      }
    },
    [router, path],
  );

  const signOut = useCallback(async () => {
    await authClient.signOut();
    await refetch();
    router.push("/sign-in");
  }, [refetch, router]);

  const value = useMemo(
    () => ({ user: data?.user ?? null, loading: isPending, signOut, request }),
    [data?.user, isPending, signOut, request],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
