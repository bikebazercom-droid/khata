import type { Plugin } from 'vite';

export function isPublicSupabaseKey(value: string): boolean {
  const key = value.trim();
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')).role === 'anon';
  } catch {
    return false;
  }
}

/**
 * Google OAuth is optional: a bad browser key must disable that provider, not
 * stop phone sign-in or the entire ledger. Never embed a private key in JS.
 */
export function publicSupabaseKeyOnly(): Plugin {
  return {
    name: 'public-supabase-key-only',
    enforce: 'pre',
    configResolved(config) {
      const key = config.env.VITE_SUPABASE_ANON_KEY?.trim() || '';
      const invalid = Boolean(key) && !isPublicSupabaseKey(key);
      config.env.VITE_SUPABASE_ANON_KEY = invalid ? '' : key;
      config.env.VITE_SUPABASE_GOOGLE_CONFIG_ERROR = invalid ? 'invalid-public-key' : '';
      // Also override explicit define entries so neither direct property reads
      // nor the complete import.meta.env object can contain an unsafe key.
      const safeDefines = {
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(config.env.VITE_SUPABASE_ANON_KEY),
        'import.meta.env.VITE_SUPABASE_GOOGLE_CONFIG_ERROR': JSON.stringify(config.env.VITE_SUPABASE_GOOGLE_CONFIG_ERROR),
      };
      Object.assign(config.define ??= {}, safeDefines);
      // Vite 7 has already copied define/env settings into its environments
      // before configResolved. Updating only the top level is too late.
      for (const environment of Object.values(config.environments ?? {})) {
        Object.assign(environment.define ??= {}, safeDefines);
      }
      if (invalid) {
        config.logger.warn(
          '[BanglaKhata] Ignored unsafe or invalid VITE_SUPABASE_ANON_KEY. ' +
          'Web Google sign-in is unavailable; phone sign-in and the ledger remain available. ' +
          'Configure a public Supabase publishable key or legacy anon key, never a secret/service-role key.',
        );
      }
    },
  };
}
