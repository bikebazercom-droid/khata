/**
 * Keep the native phone credential in a page-local closure, not browser storage.
 * Cookies can be absent after Android backgrounds/recreates a WebView.
 */
export function createNativePhoneFetchScript(token: string | null): string {
  return `(() => {
    const nextToken = ${JSON.stringify(token)};
    if (window.__BKH_SET_NATIVE_PHONE_SESSION__) {
      window.__BKH_SET_NATIVE_PHONE_SESSION__(nextToken);
      return;
    }
    let sessionToken = nextToken;
    const originalFetch = window.fetch.bind(window);
    window.__BKH_SET_NATIVE_PHONE_SESSION__ = (value) => { sessionToken = value; };
    window.fetch = (input, init) => {
      const options = init || {};
      const isRequest = typeof Request !== 'undefined' && input instanceof Request;
      const url = new URL(typeof input === 'string' ? input : (input.url || String(input)), window.location.href);
      const headers = new Headers(isRequest ? input.headers : undefined);
      new Headers(options.headers).forEach((value, name) => headers.set(name, value));
      const publicAuth = /^\\/api\\/auth\\/(?:firebase\\/session|supabase\\/session|phone\\/(?:send-otp|verify-otp))\\/?$/.test(url.pathname);
      if (sessionToken && url.origin === window.location.origin
          && url.pathname.startsWith('/api/') && !publicAuth
          && (options.credentials || (isRequest && input.credentials)) !== 'omit'
          && !headers.has('Authorization')) {
        headers.set('Authorization', 'Bearer ' + sessionToken);
        headers.set('x-banglakhata-native-session', '1');
        headers.set('x-client-platform', 'mobile');
      }
      return originalFetch(input, { ...options, headers });
    };
  })(); true;`;
}
