import type { Lang } from '@/lib/i18n';

const SELECTION_KEY_PREFIX = 'banglakhata-language-selected:';

function selectionKey(userId: string) {
  return `${SELECTION_KEY_PREFIX}${userId}`;
}

export function getLanguageSelection(userId: string): Lang | null {
  try {
    const value = window.localStorage.getItem(selectionKey(userId));
    return value === 'bn' || value === 'en' ? value : null;
  } catch {
    return null;
  }
}

export function markLanguageSelection(userId: string, language: Lang) {
  try {
    window.localStorage.setItem(selectionKey(userId), language);
    window.localStorage.setItem('banglakhata-language', language);
  } catch {
    // The authenticated server preference remains authoritative if storage is unavailable.
  }
}

export async function fetchLanguagePreference(): Promise<Lang | null> {
  const response = await fetch('/api/user/preferences', {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Could not load language preference (${response.status}).`);
  const body = (await response.json()) as { language?: unknown };
  return body.language === 'bn' || body.language === 'en' ? body.language : null;
}

export async function saveLanguagePreference(language: Lang): Promise<void> {
  const response = await fetch('/api/user/preferences', {
    method: 'PATCH',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  if (!response.ok) throw new Error(`Could not save language preference (${response.status}).`);
}
