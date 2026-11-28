// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build, createServer, type Plugin, type ResolvedConfig } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isPublicSupabaseKey, publicSupabaseKeyOnly } from '../../vite-public-supabase';

function jwt(role: string) {
  return `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture_signature`;
}
afterEach(() => { vi.unstubAllEnvs(); });

describe('Supabase browser configuration safety', () => {
  it.each(['', 'not-a-key', 'sb_secret_fixture_never_expose', jwt('service_role'), 'e30.e30.signature'])(
    'rejects missing, malformed and private browser keys (%#)', (value) => {
      expect(isPublicSupabaseKey(value)).toBe(false);
    },
  );
  it.each(['sb_publishable_public_test_fixture', jwt('anon')])(
    'accepts publishable and legacy public anon keys (%#)', (value) => {
      expect(isPublicSupabaseKey(value)).toBe(true);
    },
  );
  it.each(['sb_secret_private_build_fixture', jwt('service_role'), 'malformed-public-config'])(
    'builds without leaking invalid keys through direct, defined, or complete env access (%#)', async (key) => {
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', key);
      const virtual: Plugin = {
        name: 'browser-config-fixture',
        resolveId: (id) => id === 'virtual:browser-config' ? id : undefined,
        load: (id) => id === 'virtual:browser-config'
          ? 'console.log(import.meta.env.VITE_SUPABASE_ANON_KEY, import.meta.env, import.meta.env.VITE_SUPABASE_GOOGLE_CONFIG_ERROR);'
          : undefined,
      };
      const logs: string[] = [];
      const output = await build({
        configFile: false, envFile: false, logLevel: 'silent',
        ...(key.startsWith('sb_') ? {
          define: { 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(key) },
        } : {}),
        plugins: [publicSupabaseKeyOnly(), virtual, {
          name: 'verify-safe-env',
          configResolved(config) {
            expect(config.env.VITE_SUPABASE_ANON_KEY).toBe('');
            expect(config.env.VITE_SUPABASE_GOOGLE_CONFIG_ERROR).toBe('invalid-public-key');
          },
        }],
        customLogger: {
          hasWarned: false, info() {}, warn: (message) => { logs.push(message); },
          warnOnce() {}, error() {}, clearScreen() {}, hasErrorLogged: () => false,
        },
        build: { write: false, minify: false, rollupOptions: { input: 'virtual:browser-config' } },
      });
      const bundles = Array.isArray(output) ? output : [output];
      const code = bundles.flatMap((bundle) => 'output' in bundle ? bundle.output : [])
        .filter((chunk) => chunk.type === 'chunk').map((chunk) => chunk.code).join('\n');
      expect(code).not.toContain(key);
      expect(code).toContain('invalid-public-key');
      expect(logs.join('\n')).not.toContain(key);
      expect(logs.join('\n')).toContain('phone sign-in');
    },
  );
  it('leaves an absent optional key alone without warning or shutting down the app', () => {
    const warn = vi.fn();
    const config = { env: {}, logger: { warn } } as unknown as ResolvedConfig;
    const hook = publicSupabaseKeyOnly().configResolved;
    if (typeof hook !== 'function') throw new Error('Expected configuration hook');
    hook.call({} as never, config);
    expect(warn).not.toHaveBeenCalled();
    expect(config.env.VITE_SUPABASE_ANON_KEY).toBe('');
    expect(config.env.VITE_SUPABASE_GOOGLE_CONFIG_ERROR).toBe('');
  });
  it('also strips the key from development-server env injection', async () => {
    const key = 'sb_secret_private_build_fixture';
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', key);
    const root = await mkdtemp(path.join(tmpdir(), 'khata-safe-env-'));
    const server = await createServer({
      root, configFile: false, envFile: false, logLevel: 'silent',
      plugins: [publicSupabaseKeyOnly()],
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    try {
      await writeFile(path.join(root, 'browser.js'), 'console.log(import.meta.env, import.meta.env.VITE_SUPABASE_ANON_KEY);');
      const output = await server.transformRequest('/browser.js');
      expect(output?.code).not.toContain(key);
      expect(output?.code).toContain('invalid-public-key');
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
