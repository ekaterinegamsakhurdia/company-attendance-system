// What the e-mail link that brought the person here asked for. Read once, before the
// Supabase client starts and removes the token from the address bar (this file must be
// imported before anything that imports the client).
function read() {
  if (typeof window === 'undefined') return {};
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const type = hash.get('type') || query.get('type') || '';
  return {
    type, // 'invite' | 'recovery' | ''
    tokenHash: query.get('token_hash') || '',
    error: (hash.get('error_description') || query.get('error_description') || '').replaceAll('+', ' '),
    hasToken: Boolean(hash.get('access_token') || hash.get('refresh_token') || query.get('code')),
  };
}

export const authLink = read();

/** True when this page load came from an invitation or password-reset link, whatever path it landed on. */
export const isPasswordLink = (link = authLink) =>
  Boolean(link.error || link.tokenHash || (link.hasToken && (link.type === 'invite' || link.type === 'recovery' || link.type === 'signup')));
