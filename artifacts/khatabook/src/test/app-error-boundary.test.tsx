import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../components/app-error-boundary';

function CrashingChild(): never {
  throw new Error('simulated render failure');
}

describe('AppErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a recovery screen instead of leaving the root blank', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <AppErrorBoundary>
        <CrashingChild />
      </AppErrorBoundary>,
    );

    expect(screen.getByTestId('app-error-boundary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'পৃষ্ঠা আবার লোড করুন' })).toBeInTheDocument();
    expect(screen.getByTestId('app-error-diagnostic')).toHaveTextContent('Error: simulated render failure');
  });
});