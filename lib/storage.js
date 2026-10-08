const browserApi = globalThis.browser ?? globalThis.chrome;

export const DEFAULT_API_BASE_URL = 'https://tagsta.sh/api';

export const STORAGE_KEYS = {
  apiBaseUrl: 'tagstash.apiBaseUrl',
  token: 'tagstash.token',
  user: 'tagstash.user',
  openLinksInNewTab: 'tagstash.openLinksInNewTab',
};

// The sidebar has always opened bookmarks in the current tab, so that stays the
// default. This is deliberately extension-local: the website has its own
// equivalent setting and the two never sync.
export const DEFAULT_OPEN_LINKS_IN_NEW_TAB = false;

export async function getSettings() {
  const stored = await browserApi.storage.local.get(Object.values(STORAGE_KEYS));

  return {
    apiBaseUrl: stored[STORAGE_KEYS.apiBaseUrl] || DEFAULT_API_BASE_URL,
    token: stored[STORAGE_KEYS.token] || null,
    user: stored[STORAGE_KEYS.user] || null,
    openLinksInNewTab: stored[STORAGE_KEYS.openLinksInNewTab] ?? DEFAULT_OPEN_LINKS_IN_NEW_TAB,
  };
}

export async function saveApiBaseUrl(apiBaseUrl) {
  await browserApi.storage.local.set({
    [STORAGE_KEYS.apiBaseUrl]: apiBaseUrl,
  });
}

export async function saveOpenLinksInNewTab(openLinksInNewTab) {
  await browserApi.storage.local.set({
    [STORAGE_KEYS.openLinksInNewTab]: Boolean(openLinksInNewTab),
  });
}

// The dashboard's last-loaded tags and bookmarks, so it can paint instantly
// before the API answers. Kept out of STORAGE_KEYS so getSettings() doesn't
// read the whole library on every popup/sidebar open.
export const HOME_CACHE_KEY = 'tagstash.homeCache';

export async function getHomeCache() {
  const stored = await browserApi.storage.local.get(HOME_CACHE_KEY);
  return stored[HOME_CACHE_KEY] || null;
}

export async function saveHomeCache(tags, bookmarks) {
  await browserApi.storage.local.set({
    [HOME_CACHE_KEY]: { tags, bookmarks, savedAt: Date.now() },
  });
}

export async function saveSession(token, user) {
  await browserApi.storage.local.set({
    [STORAGE_KEYS.token]: token,
    [STORAGE_KEYS.user]: user,
  });
}

export async function clearSession() {
  await browserApi.storage.local.remove([
    STORAGE_KEYS.token,
    STORAGE_KEYS.user,
    HOME_CACHE_KEY,
  ]);
}
