// Prefix an internal path with the configured base (currently '/'). Every internal href/src goes
// through this so switching to a project subpath or custom domain is a one-line config change.
// External URLs (http:, https:, mailto:), protocol-relative, and in-page hashes pass through untouched.
export function withBase(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//') || path.startsWith('#')) {
    return path;
  }
  const base = import.meta.env.BASE_URL.replace(/\/$/, ''); // '' when base is '/', '/portfolio' otherwise
  return base + '/' + String(path).replace(/^\//, '');
}
