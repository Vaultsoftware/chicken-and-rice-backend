// ============================================================================
// File: utils/routePrefix.js  (use this to sanitize env-based prefixes)
// ============================================================================
function routePrefixFromEnv(envVarName, fallback = '/') {
  const raw = process.env[envVarName];
  if (!raw) return fallback;

  // If a full URL was provided, extract only the pathname.
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      return u.pathname || '/';
    }
  } catch {
    // not a URL; continue
  }

  // Ensure it starts with a slash.
  if (!raw.startsWith('/')) return '/' + raw.replace(/^[^/]+/, '$&');
  return raw || fallback;
}
module.exports = { routePrefixFromEnv };
