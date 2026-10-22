import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Router, useLocation } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { LandingPage } from '@/pages/landing';

function CurrentLocation() {
  const [location] = useLocation();
  return <span data-testid="current-location">{location}</span>;
}

describe('landing page navigation', () => {
  it('navigates to the sign-in route without a full-page reload', () => {
    const memory = memoryLocation({ path: '/' });
    render(
      <Router hook={memory.hook}>
        <CurrentLocation />
        <Route path="/" component={LandingPage} />
        <Route path="/sign-in" component={() => <h1>Sign-in form</h1>} />
      </Router>,
    );

    fireEvent.click(screen.getByTestId('link-landing-sign-in'));

    expect(screen.getByTestId('current-location')).toHaveTextContent('/sign-in');
    expect(screen.getByRole('heading', { name: 'Sign-in form' })).toBeInTheDocument();
  });
});
