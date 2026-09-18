"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";

import { ensureUser, getClientAuth, getIdToken } from "./firebase/client";

export interface Identity {
  uid: string | null;
  /** Name the visitor last submitted under, remembered locally. */
  name: string;
  isAdmin: boolean;
  ready: boolean;
  error: string | null;
  setName: (name: string) => void;
  /** Adds `Authorization: Bearer <token>` and posts JSON to our own API. */
  authedFetch: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * Force-refreshes the ID token and re-asks the server who we are.
   *
   * Called straight after a Google sign-in. Linking a provider does not
   * always re-fire onAuthStateChanged, and the SDK will happily keep serving
   * the token it minted seconds ago - the anonymous one, with no email on
   * it - so without forcing a refresh the portal would keep insisting you
   * are not an admin until the cached token expired.
   */
  refresh: () => Promise<boolean>;
}

const NAME_KEY = "ryder.feedback.name";

const AuthContext = createContext<Identity | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setNameState] = useState("");

  // Restore the remembered display name. Wrapped because storage throws
  // outright in some privacy modes rather than just returning null.
  useEffect(() => {
    try {
      setNameState(localStorage.getItem(NAME_KEY) ?? "");
    } catch {
      /* no-op */
    }
  }, []);

  const setName = useCallback((next: string) => {
    setNameState(next);
    try {
      localStorage.setItem(NAME_KEY, next);
    } catch {
      /* no-op */
    }
  }, []);

  // Ask the server, not the token: see src/app/api/me/route.ts.
  const checkAdmin = useCallback(
    async (u: User, forceRefresh = false): Promise<boolean> => {
      try {
        const token = await u.getIdToken(forceRefresh);
        const res = await fetch("/api/me", {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { isAdmin?: boolean };
        return Boolean(data?.isAdmin);
      } catch {
        return false;
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    // Whether this session has ever held a user. It separates the two ways
    // onAuthStateChanged reports null, which need opposite handling - see
    // the branch below.
    let sawUser = false;

    ensureUser().catch((err: unknown) => {
      if (cancelled) return;
      setError(
        err instanceof Error
          ? err.message
          : "Could not reach Firebase Authentication.",
      );
      setReady(true);
    });

    const unsub = onAuthStateChanged(getClientAuth(), (u) => {
      if (cancelled) return;
      setUser(u);
      if (!u) {
        setIsAdmin(false);
        // Two very different situations arrive here as the same null.
        //
        // A cold load fires null once before the anonymous sign-in that
        // ensureUser kicked off has landed. That is not an answer, so we
        // keep the skeleton up rather than flashing a gate that names no
        // uid; the sign-in - or its failure, handled above - settles it.
        //
        // Being dropped from a session we already had is an answer, and the
        // one that used to hang: a revoked refresh token signs the SDK out,
        // no further callback is coming, and ready never flipped.
        if (sawUser) setReady(true);
        return;
      }
      sawUser = true;
      checkAdmin(u).then((admin) => {
        if (cancelled) return;
        setIsAdmin(admin);
        setReady(true);
      });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [checkAdmin]);

  const refresh = useCallback(async () => {
    const u = getClientAuth().currentUser ?? (await ensureUser());
    const admin = await checkAdmin(u, true);
    setIsAdmin(admin);
    setReady(true);
    return admin;
  }, [checkAdmin]);

  const authedFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const token = await getIdToken();
      return fetch(url, {
        ...init,
        headers: {
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers ?? {}),
          authorization: `Bearer ${token}`,
        },
      });
    },
    [],
  );

  const value = useMemo<Identity>(
    () => ({
      uid: user?.uid ?? null,
      name,
      isAdmin,
      ready,
      error,
      setName,
      authedFetch,
      refresh,
    }),
    [user?.uid, name, isAdmin, ready, error, setName, authedFetch, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useIdentity(): Identity {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useIdentity must be used inside <AuthProvider>");
  return ctx;
}
