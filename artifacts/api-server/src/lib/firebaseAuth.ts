export type FirebaseIdentity = {
  uid: string;
  email: string;
  displayName?: string;
};

/**
 * Ask Firebase Auth to validate the ID token and return its trusted account
 * claims. No service-account private key is required for this lookup.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseIdentity | null> {
  const apiKey = process.env.VITE_FIREBASE_API_KEY?.trim();
  if (!apiKey) throw new Error("Firebase Auth is not configured on the API server");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;

    const payload = await response.json() as {
      users?: Array<{ localId?: string; email?: string; emailVerified?: boolean; displayName?: string }>;
    };
    const user = payload.users?.[0];
    const email = user?.email?.trim().toLowerCase();
    if (!user?.localId || !email || user.emailVerified !== true) return null;
    return {
      uid: user.localId,
      email,
      ...(user.displayName ? { displayName: user.displayName } : {}),
    };
  } finally {
    clearTimeout(timeout);
  }
}
