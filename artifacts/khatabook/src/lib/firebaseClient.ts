import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  type Auth,
  type UserCredential,
} from 'firebase/auth';

function getFirebaseAuth(): Auth {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    throw new Error(`Firebase is not configured. Missing: ${missing.join(', ')}`);
  }
  const app = getApps().length ? getApp() : initializeApp(config);
  return getAuth(app);
}

let persistenceReady: Promise<void> | undefined;
function readyAuth(): Promise<Auth> {
  const auth = getFirebaseAuth();
  persistenceReady ??= setPersistence(auth, browserLocalPersistence);
  return persistenceReady.then(() => auth);
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export async function beginGoogleSignIn(): Promise<UserCredential | null> {
  const auth = await readyAuth();
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw error;
  }
}

export async function finishGoogleRedirect(): Promise<UserCredential | null> {
  const auth = await readyAuth();
  return getRedirectResult(auth);
}

export async function exchangeFirebaseSession(credential: UserCredential): Promise<void> {
  const idToken = await credential.user.getIdToken();
  const response = await fetch('/api/auth/firebase/session', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || 'Google sign-in could not be completed.');
  }
}

export async function signOutFirebase(): Promise<void> {
  const response = await fetch('/api/auth/logout-event', {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok && response.status !== 401) {
    throw new Error('The server could not confirm sign-out.');
  }
  const auth = getFirebaseAuth();
  const { signOut } = await import('firebase/auth');
  await signOut(auth);
}

export function subscribeFirebaseEmail(onEmail: (email: string | null) => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), (user) => onEmail(user?.email ?? null));
}
