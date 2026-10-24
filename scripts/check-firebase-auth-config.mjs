const requiredVariables = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

const missingVariables = requiredVariables.filter((name) => !process.env[name]?.trim());
if (missingVariables.length > 0) {
  console.error(`Missing Firebase environment variables: ${missingVariables.join(", ")}`);
  process.exit(1);
}

const apiKey = process.env.VITE_FIREBASE_API_KEY.trim();
if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(apiKey)) {
  console.error("VITE_FIREBASE_API_KEY does not look like a Firebase Web API key.");
  process.exit(1);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 8_000);

try {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        referer: "https://banglakhata.com/",
      },
      body: JSON.stringify({ idToken: "hostinger-build-config-preflight-invalid-token" }),
      signal: controller.signal,
    },
  );

  const payload = await response.json().catch(() => ({}));
  const errorMessage = payload?.error?.message;
  if (errorMessage === "INVALID_ID_TOKEN") {
    console.log("Firebase Auth API key preflight passed.");
  } else {
    const safeReason = typeof errorMessage === "string" ? errorMessage : `HTTP ${response.status}`;
    console.warn(
      `Warning: Firebase Auth could not validate the configured Web API key (${safeReason}). ` +
      "Continuing the build; Google Sign-In may fail until the key and Identity Toolkit restrictions are corrected.",
    );
  }
} catch (error) {
  const message = error instanceof Error && error.name === "AbortError"
    ? "request timed out"
    : "Firebase Auth could not be reached";
  console.warn(
    `Warning: Firebase Auth API key preflight could not complete (${message}). ` +
    "Continuing the build; verify Google Sign-In after deployment.",
  );
} finally {
  clearTimeout(timeout);
}
