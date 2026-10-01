import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const PHONE_TOKEN_KEY = 'banglakhata.phone-session';

export function getSavedAuthToken(): Promise<string | null> {
  if (Platform.OS === 'web') return Promise.resolve(null);
  return SecureStore.getItemAsync(PHONE_TOKEN_KEY);
}

export function saveAuthToken(token: string): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  return SecureStore.setItemAsync(PHONE_TOKEN_KEY, token);
}

export function clearSavedAuthToken(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  return SecureStore.deleteItemAsync(PHONE_TOKEN_KEY);
}