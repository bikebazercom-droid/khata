/**
 * Design tokens synced from the sibling khatabook web artifact (index.css).
 * HSL values converted to hex. Both light and dark themes provided.
 */

const colors = {
  light: {
    // Surfaces
    background: '#f8fafc',   // hsl(210 40% 98%)
    foreground: '#132949',   // hsl(215 58% 18%)
    card: '#ffffff',
    cardForeground: '#132949',

    // Primary action
    primary: '#1b3c69',      // hsl(215 59% 26%)
    primaryForeground: '#ffffff',

    // Secondary / muted
    secondary: '#f1f5f9',
    secondaryForeground: '#132949',
    muted: '#f1f5f9',        // hsl(210 40% 96.1%)
    mutedForeground: '#64748b', // hsl(215.4 16.3% 46.9%)

    // Accent
    accent: '#f5a524',       // hsl(37 91% 55%)
    accentForeground: '#ffffff',

    // Borders / inputs
    border: '#e2e8f0',       // hsl(214 32% 91%)
    input: '#e2e8f0',

    // Status
    destructive: '#ef4444',
    destructiveForeground: '#f8fafc',

    // Financial semantics (echoes web app balance colors)
    willGet: '#10b981',    // emerald — you will receive (good for shop)
    willGive: '#ef4444',   // red — you must pay (money going out)
    willGetBg: '#ecfdf5',  // emerald-50
    willGiveBg: '#fef2f2', // red-50

    // Legacy
    text: '#132949',
    tint: '#1b3c69',
  },

  dark: {
    background: '#0f172a',   // hsl(222 47% 11%)
    foreground: '#f8fafc',   // hsl(210 40% 98%)
    card: '#0f172a',
    cardForeground: '#f8fafc',

    primary: '#f8fafc',
    primaryForeground: '#0f172a',

    secondary: '#1e293b',
    secondaryForeground: '#f8fafc',
    muted: '#1e293b',        // hsl(217.2 32.6% 17.5%)
    mutedForeground: '#94a3b8', // hsl(215 20.2% 65.1%)

    accent: '#1e293b',
    accentForeground: '#f8fafc',

    border: '#1e293b',
    input: '#1e293b',

    destructive: '#7f1d1d',
    destructiveForeground: '#f8fafc',

    willGet: '#10b981',
    willGive: '#ef4444',
    willGetBg: '#022c22',
    willGiveBg: '#450a0a',

    text: '#f8fafc',
    tint: '#f8fafc',
  },

  // Matches web --radius: 0.5rem = 8px
  radius: 8,
};

export default colors;
