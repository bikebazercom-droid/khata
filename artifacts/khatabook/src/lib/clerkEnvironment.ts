export type ClerkClientEnvironment = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  VITE_CLERK_PUBLISHABLE_KEY?: string;
  VITE_CLERK_PROXY_URL?: string;
};

export function resolveClerkClientEnvironment(env: ClerkClientEnvironment) {
  const externalPublishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

  return {
    publishableKey: externalPublishableKey || env.VITE_CLERK_PUBLISHABLE_KEY,
    // The external production key points to its own Clerk Frontend API. Do not
    // send its requests through the Replit-managed Clerk proxy.
    proxyUrl: externalPublishableKey ? undefined : env.VITE_CLERK_PROXY_URL,
  };
}
