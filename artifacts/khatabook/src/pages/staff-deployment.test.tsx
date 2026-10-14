import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StaffDeploymentPage } from './staff-deployment';
import { LanguageProvider, LANGUAGE_STORAGE_KEY } from '@/lib/i18n';

vi.mock('wouter', () => ({
  useLocation: () => ['/staff-deployment', vi.fn()],
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/lib/businessContext', () => ({
  useBusinessContext: () => ({ selectedBusinessId: null }),
}));
vi.mock('@/components/modals/settings-drawer', () => ({
  SettingsDrawer: () => null,
}));

describe('staff duty page localization', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  });

  it('translates the header, navigation, metrics, and empty state in English', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    render(<LanguageProvider><StaffDeploymentPage /></LanguageProvider>);

    expect(screen.getByRole('heading', { name: 'Staff duty details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duty queue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duty logs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Destinations' })).toBeInTheDocument();
    expect(screen.getByText('Deployed today')).toBeInTheDocument();
    expect(screen.getByText('In queue')).toBeInTheDocument();
    expect(screen.getByText('No staff added')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add new staff' })).toBeInTheDocument();
  });
});
