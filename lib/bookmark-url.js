// URL helpers shared by the popup and the edit dialog.
//
// normalizeBookmarkUrl is a copy of the same function in Tagstash/src/App.jsx and
// Tagstash/functions/api/[[path]].js. If you change the rules, update all three.

export function isSupportedUrl(url) {
  try {
    const parsed = new URL(url || '');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeBookmarkUrl(value) {
  const raw = (value || '').trim();
  if (!raw) return '';

  let normalized;
  if (/^https?:\/\//i.test(raw)) {
    normalized = raw;
  } else {
    const cleaned = raw
      .replace(/^https?:/i, '')
      .replace(/^\/\//, '')
      .trim();

    normalized = cleaned ? `https://${cleaned}` : '';
  }
  if (!normalized) return '';

  // Keep a trailing slash on bare roots, including URLs produced by Base URL.
  try {
    const parsed = new URL(normalized);
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      return `${parsed.origin}/`;
    }
  } catch {}

  return normalized;
}

// Base URL: keep only the site root, e.g. https://example.com/docs?x=1 -> https://example.com/.
// Returns null when the value isn't a usable URL.
export function toBaseUrl(value) {
  try {
    return `${new URL(normalizeBookmarkUrl(value)).origin}/`;
  } catch {
    return null;
  }
}

// Trim URL: drop the query string and hash, keep the path.
export function toTrimmedUrl(value) {
  try {
    const u = new URL(normalizeBookmarkUrl(value));
    return u.origin + u.pathname;
  } catch {
    return null;
  }
}
