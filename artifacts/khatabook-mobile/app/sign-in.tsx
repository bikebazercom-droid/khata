import { Redirect } from 'expo-router';

export default function MobileSignInRoute() {
  // Authentication for the mobile app is served by the shared website WebView.
  return <Redirect href="/" />;
}
