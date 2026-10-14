import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SettingsDrawer } from './settings-drawer';

const mocks = vi.hoisted(() => ({
  setLang: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useClerk: () => ({ signOut: vi.fn() }),
  useAuth: () => ({ isSignedIn: true }),
  useUser: () => ({ user: null }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ clear: vi.fn() }),
}));
vi.mock('@workspace/api-client-react', () => ({
  useRemoveOwnerPushToken: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('wouter', () => ({
  useLocation: () => ['/dashboard', vi.fn()],
}));
vi.mock('@/lib/i18n', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    lang: 'bn',
    setLang: mocks.setLang,
  }),
}));
vi.mock('@/App', () => ({
  useAppAuth: () => ({
    isAuthenticated: true,
    role: 'owner',
    phone: null,
    authMethod: 'email',
    userId: null,
  }),
}));

describe('settings drawer language selection', () => {
  afterEach(() => {
    cleanup();
    mocks.setLang.mockClear();
  });

  it('expands language choices underneath the row and switches language on selection', () => {
    render(<SettingsDrawer open onOpenChange={vi.fn()} />);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'আরও অপশন' }), {
      button: 0,
      ctrlKey: false,
    });
    const languageRow = screen.getByRole('menuitem', { name: /Language \/ ভাষা/ });
    fireEvent.click(languageRow);

    const options = screen.getByRole('group', { name: 'Language options' });
    expect(within(options).getByRole('menuitemradio', { name: 'বাংলা' })).toBeInTheDocument();
    fireEvent.click(within(options).getByRole('menuitemradio', { name: 'English' }));

    expect(mocks.setLang).toHaveBeenCalledWith('en');
  });
});
