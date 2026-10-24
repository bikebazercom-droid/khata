import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MobileSignInRoute from '../app/sign-in';

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="mobile-sign-in-redirect">{href}</div>,
}));

describe('mobile sign-in route', () => {
  it('routes authentication through the shared website WebView', () => {
    render(<MobileSignInRoute />);
    expect(screen.getByTestId('mobile-sign-in-redirect').textContent).toBe('/');
  });
});
