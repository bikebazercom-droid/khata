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

  it('opens the floating module menu, switches views, and closes the sheet', () => {
    render(<SettingsDrawer open onOpenChange={vi.fn()} />);
    const menuButton = screen.getByTestId('button-invoice-menu');
    const footer = menuButton.closest('footer');
    expect(footer).toHaveClass('justify-start', 'px-4', 'z-20');
    fireEvent.click(menuButton);
    expect(screen.getByTestId('menu-option-profile')).toBeInTheDocument();
    expect(screen.getByTestId('menu-option-invoice')).toBeInTheDocument();
    expect(screen.getByTestId('menu-option-gold')).toBeInTheDocument();
    expect(screen.getByTestId('menu-option-list')).toBeInTheDocument();
    const options = screen.getByTestId('invoice-menu-options');
    const backdrop = screen.getByTestId('invoice-menu-backdrop');
    const sheet = backdrop.querySelector<HTMLElement>('[role="dialog"]');
    expect(backdrop).toHaveClass('absolute', 'inset-0');
    expect(sheet).not.toBeNull();
    expect(sheet).toHaveClass(
      'absolute',
      'left-3',
      'w-80',
      'max-w-[calc(100vw_-_1.5rem)]',
      'rounded-2xl',
      'max-h-[calc(100dvh_-_6rem_-_var(--safe-bottom))]',
    );
    expect(options).toHaveClass('flex', 'flex-col');
    expect(within(options).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'বিজনেস প্রোফাইল',
      'বিজনেস ইনভয়েস',
      'গোল্ড ইনভয়েস',
      'ইনভয়েস তালিকা',
    ]);
    for (const button of within(options).getAllByRole('button')) {
      expect(button).toHaveClass('w-full', 'min-h-12', 'justify-start');
    }
    fireEvent.click(screen.getByTestId('menu-option-gold'));
    expect(screen.queryByRole('dialog', { name: 'Invoice menu' })).not.toBeInTheDocument();
    expect(screen.getByTestId('button-gold-save-history')).toBeInTheDocument();
  });

  it('lets an authenticated owner open the OTP phone-link flow', () => {
    render(<SettingsDrawer open onOpenChange={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'আরও অপশন' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByTestId('menu-link-phone'));

    expect(screen.getByRole('heading', { name: 'এই account-এ ফোন নম্বর যুক্ত করুন' })).toBeInTheDocument();
    expect(screen.getByTestId('input-phone-link-number')).toBeInTheDocument();
  });

  it('generates Business and Gold invoices and redirects to the updated history list', () => {
    localStorage.removeItem('banglakhata_invoice_history_v1:default');
    render(<SettingsDrawer open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByTestId('input-invoice-customer'), { target: { value: 'Business Customer' } });
    fireEvent.click(screen.getByTestId('button-invoice-save-history'));
    expect(screen.getByRole('heading', { name: 'ইনভয়েস তালিকা' })).toBeInTheDocument();
    expect(screen.getAllByText('Business Customer').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('button-invoice-menu'));
    fireEvent.click(screen.getByTestId('menu-option-gold'));
    fireEvent.change(screen.getByTestId('input-gold-customerName'), { target: { value: 'Gold Customer' } });
    fireEvent.click(screen.getByTestId('button-gold-save-history'));

    expect(screen.getByRole('heading', { name: 'ইনভয়েস তালিকা' })).toBeInTheDocument();
    expect(screen.getAllByText('Gold Customer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Business Customer').length).toBeGreaterThan(0);
  });

  it('opens the dedicated persistent business profile editor from the bottom sheet', () => {
    render(<SettingsDrawer open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('button-invoice-menu'));
    fireEvent.click(screen.getByTestId('menu-option-profile'));
    expect(screen.getByRole('heading', { name: 'বিজনেস প্রোফাইল' })).toBeInTheDocument();
    expect(screen.getByText('কোম্পানির সিল আপলোড')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('input-business-profile-company'), { target: { value: 'Sample Shop' } });
    fireEvent.click(screen.getByTestId('button-business-profile-save'));
    expect(JSON.parse(localStorage.getItem('banglakhata_business_invoice_profile_v1:default') || '{}')).toMatchObject({ company: 'Sample Shop' });
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
