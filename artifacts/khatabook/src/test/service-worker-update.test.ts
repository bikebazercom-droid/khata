import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPendingShellReload,
  handleShellVersionMessage,
  PENDING_SHELL_RELOAD_KEY,
} from '../lib/serviceWorkerUpdate';

describe('service-worker updates during Clerk sign-in', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it.each(['/sign-in', '/sign-in/sso-callback'])(
    'defers a shell-version message on %s until the auth flow leaves',
    (path) => {
      const reload = vi.fn();
      const message = { type: 'banglakhata-shell-version', version: 'shell-v2' };

      expect(handleShellVersionMessage(message, path, null, reload)).toBe('shell-v2');
      expect(reload).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(PENDING_SHELL_RELOAD_KEY)).toBe('shell-v2');
      expect(applyPendingShellReload(path, reload)).toBe(false);
      expect(reload).not.toHaveBeenCalled();

      expect(applyPendingShellReload('/dashboard', reload)).toBe(true);
      expect(reload).toHaveBeenCalledOnce();
      expect(sessionStorage.getItem(PENDING_SHELL_RELOAD_KEY)).toBeNull();
    },
  );

  it('does not reload the landing page before the user can open sign-in', () => {
    const reload = vi.fn();
    const message = { type: 'banglakhata-shell-version', version: 'shell-v2' };

    expect(handleShellVersionMessage(message, '/', null, reload)).toBe('shell-v2');
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_SHELL_RELOAD_KEY)).toBe('shell-v2');
    expect(applyPendingShellReload('/', reload)).toBe(false);
    expect(applyPendingShellReload('/sign-in', reload)).toBe(false);

    expect(applyPendingShellReload('/dashboard', reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(PENDING_SHELL_RELOAD_KEY)).toBeNull();
  });
});
