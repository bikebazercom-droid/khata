import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SettingsDrawer } from './settings-drawer';

const mocks = vi.hoisted(() => ({
  setLang: vi.fn(),
  lang: 'bn' as 'bn' | 'en',
  clerkUser: null as null | { primaryEmailAddress?: { emailAddress: string } },
}));

vi.mock('@clerk/react', () => ({
  useClerk: () => ({ signOut: vi.fn() }),
  useAuth: () => ({ isSignedIn: true }),
  useUser: () => ({ user: mocks.clerkUser }),
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
    t: (key: string) => ({
      back: mocks.lang === 'en' ? 'Back' : 'ফিরে যান',
      moreOptions: mocks.lang === 'en' ? 'More options' : 'আরও অপশন',
      languageOptions: mocks.lang === 'en' ? 'Language options' : 'ভাষার বিকল্প',
      deleteAccount: mocks.lang === 'en' ? 'Delete account' : 'খাতা ডিলিট করুন',
      confirmDeleteTitle: mocks.lang === 'en' ? 'Delete your entire account?' : 'সম্পূর্ণ অ্যাকাউন্ট ডিলিট করবেন?',
      confirmDeleteWarning: mocks.lang === 'en' ? 'This action cannot be undone.' : 'এই কাজটি ফিরিয়ে নেওয়া যাবে না।',
      deleteAccountIdentity: mocks.lang === 'en' ? 'Current login identity:' : 'বর্তমান লগইন পরিচয়:',
      deleteAccountPrompt: mocks.lang === 'en' ? 'Enter identity or DELETE' : 'পরিচয় বা DELETE লিখুন',
      deleteAccountPlaceholder: mocks.lang === 'en' ? 'Enter email/phone or DELETE' : 'ইমেইল/ফোন নম্বর বা DELETE লিখুন',
      deleteCancel: mocks.lang === 'en' ? 'Cancel' : 'বাতিল',
      deleteConfirm: mocks.lang === 'en' ? 'Delete permanently' : 'স্থায়ীভাবে মুছুন',
      noLogin: mocks.lang === 'en' ? 'Not logged in' : 'লগইন করা নেই',
    }[key] ?? key),
    lang: mocks.lang,
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
    mocks.lang = 'bn';
    mocks.clerkUser = null;
  });

  it('translates the settings return button to Back in English', () => {
    mocks.lang = 'en';
    render(<SettingsDrawer open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('expands language choices underneath the row and switches language on selection', () => {
    render(<SettingsDrawer open onOpenChange={vi.fn()} />);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'আরও অপশন' }), {
      button: 0,
      ctrlKey: false,
    });
    const languageRow = screen.getByRole('menuitem', { name: /Language \/ ভাষা/ });
    fireEvent.click(languageRow);

    const options = screen.getByRole('group', { name: 'ভাষার বিকল্প' });
    expect(within(options).getByRole('menuitemradio', { name: 'বাংলা' })).toBeInTheDocument();
    fireEvent.click(within(options).getByRole('menuitemradio', { name: 'English' }));

    expect(mocks.setLang).toHaveBeenCalledWith('en');
  });

  it('requires the current sign-in identity or DELETE before enabling account deletion', () => {
    mocks.lang = 'en';
    mocks.clerkUser = { primaryEmailAddress: { emailAddress: 'owner@example.com' } };
    render(<SettingsDrawer open onOpenChange={vi.fn()} />);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More options' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete account' }));

    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'Delete permanently' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Enter identity or DELETE'), { target: { value: 'owner@example.com' } });
    expect(confirmButton).toBeEnabled();
  });
});
