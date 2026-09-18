"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  type Auth,
  type User,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from "firebase/firestore";

import { ADMIN_DOMAIN } from "@/lib/access";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  if (!config.projectId) {
    throw new Error(
      "Firebase is not configured. Copy .env.local.example to .env.local and fill in the NEXT_PUBLIC_FIREBASE_* values.",
    );
  }
  app = getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function getDb(): Firestore {
  if (db) return db;
  const a = getFirebaseApp();
  // Long polling auto-detection keeps Firestore working behind the corporate
  // proxies and VPNs that break the default WebChannel transport.
  db = initializeFirestore(a, { experimentalAutoDetectLongPolling: true });
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === "1") {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  return db;
}

export function getClientAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(getFirebaseApp());
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === "1") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
  }
  return auth;
}

/**
 * Resolves to a signed-in user, creating an anonymous account if there is
 * none. Every visitor gets a stable uid, which is what makes one-vote-per-
 * person enforceable in security rules without asking anyone to register.
 */
export function ensureUser(): Promise<User> {
  const a = getClientAuth();
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      a,
      async (user) => {
        if (user) {
          unsub();
          resolve(user);
          return;
        }
        try {
          const cred = await signInAnonymously(a);
          unsub();
          resolve(cred.user);
        } catch (err) {
          unsub();
          reject(err);
        }
      },
      (err) => {
        unsub();
        reject(err);
      },
    );
  });
}

/**
 * Staff sign-in: Google, narrowed to the company domain.
 *
 * Linking rather than a plain sign-in when the current user is anonymous,
 * because by the time anyone opens /admin they have a uid that owns votes,
 * submissions and comment history. linkWithPopup upgrades that same uid to a
 * Google account and keeps all of it; signInWithPopup would strand it behind
 * an account nobody can sign into again.
 *
 * `hd` only filters the account chooser - it is a hint to Google, trivially
 * bypassed, and worth setting anyway because it stops the honest mistake of
 * picking a personal address. The decision is made by grantsAdmin() on the
 * server, against a token Google signed.
 */
export async function signInWithWorkspace(): Promise<User> {
  const a = getClientAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: ADMIN_DOMAIN, prompt: "select_account" });

  const current = a.currentUser;
  if (current?.isAnonymous) {
    try {
      const cred = await linkWithPopup(current, provider);
      return cred.user;
    } catch (err) {
      // This Google account already has a uid of its own - which is the
      // normal case on a second browser - so there is nothing to merge.
      // Anything else is a real failure and belongs to the caller.
      const code = (err as { code?: string }).code;
      if (
        code !== "auth/credential-already-in-use" &&
        code !== "auth/email-already-in-use"
      ) {
        throw err;
      }
    }
  }

  const cred = await signInWithPopup(a, provider);
  return cred.user;
}

/** Fresh ID token for authenticating calls to our own route handlers. */
export async function getIdToken(forceRefresh = false): Promise<string> {
  const user = await ensureUser();
  return user.getIdToken(forceRefresh);
}

export { getFirestore };
