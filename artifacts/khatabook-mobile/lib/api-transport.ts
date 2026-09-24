// Reuse the shared API client's configured base URL, auth token getter,
// response parsing, and HTTP error handling for mobile-only auth endpoints.
export { customFetch } from '../../../lib/api-client-react/src/custom-fetch';