import * as SecureStore from 'expo-secure-store';

export const PHONE_TOKEN_KEY = 'banglakhata.phone-session';

export function getSavedAuthToken(): Promise<string | null> {
  return SecureStore.getItemAsync(PHONE_TOKEN_KEY);
}

export function saveAuthToken(token: string): Promise<void> {
  return SecureStore.setItemAsync(PHONE_TOKEN_KEY, token);
}

export function clearSavedAuthToken(): Promise<void> {
  return SecureStore.deleteItemAsync(PHONE_TOKEN_KEY);
}