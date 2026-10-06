import { createTagstashClient } from './lib/tagstash-client.js';
import { getSettings, saveSession, clearSession } from './lib/storage.js';

const browserApi = globalThis.browser ?? globalThis.chrome;
// Set up by lib/theme.js, loaded as a classic script in popup.html's <head>.
const themeApi = globalThis.tagstashTheme;

// Show which extension build this is.
document.querySelectorAll('[data-version]').forEach((el) => {
  el.textContent = `v${browserApi.runtime.getManifest().version}`;
});

const elements = {
  authView: document.getElementById('authView'),
  saveView: document.getElementById('saveView'),
  message: document.getElementById('message'),
  loginForm: document.getElementById('loginForm'),
  loginButton: document.getElementById('loginButton'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  userLabel: document.getElementById('userLabel'),
  logoutButton: document.getElementById('logoutButton'),
  tabTitle: document.getElementById('tabTitle'),
  tabUrl: document.getElementById('tabUrl'),
  bookmarkForm: document.getElementById('bookmarkForm'),
  bookmarkTitle: document.getElementById('bookmarkTitle'),
  bookmarkUrl: document.getElementById('bookmarkUrl'),
  bookmarkDescription: document.getElementById('bookmarkDescription'),
  bookmarkTagInput: document.getElementById('bookmarkTagInput'),
  bookmarkTagPills: document.getElementById('bookmarkTagPills'),
  tagInputSuggestion: document.getElementById('tagInputSuggestion'),
  fetchTitleButton: document.getElementById('fetchTitleButton'),
  fetchDescriptionButton: document.getElementById('fetchDescriptionButton'),
  saveButton: document.getElementById('saveButton'),
  baseUrlButton: document.getElementById('baseUrlButton'),
  trimUrlButton: document.getElementById('trimUrlButton'),
  openSidebarButton: document.getElementById('openSidebarButton'),
};

const state = {
  apiBaseUrl: '',
  token: null,
  user: null,
  activeTab: null,
  existingBookmarkId: null,
  tagList: [],
  allTagNames: [],
};

function setBusy(button, isBusy, label) {
  if (!button) {
    return;
  }

  if (isBusy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
  } else if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
  }

  button.disabled = isBusy;
}

function showMessage(type, text) {
  elements.message.textContent = text;
  elements.message.className = `message ${type}`;
  elements.message.hidden = false;
}

function clearMessage() {
  elements.message.hidden = true;
  elements.message.textContent = '';
  elements.message.className = 'message';
}

function toggleView(isAuthenticated) {
  elements.authView.hidden = isAuthenticated;
  elements.saveView.hidden = !isAuthenticated;
}

function isSupportedUrl(url) {
  try {
    const parsed = new URL(url || '');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeBookmarkUrl(value) {
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

function normalizeTags(tagInput) {
  return Array.from(
    new Set(
      tagInput
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function renderTagPills() {
  elements.bookmarkTagPills.innerHTML = '';

  state.tagList.forEach((tag, index) => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill tag-stock';

    const text = document.createElement('span');
    text.textContent = tag;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'tag-pill-remove';
    removeButton.dataset.index = String(index);
    removeButton.setAttribute('aria-label', `Remove tag ${tag}`);
    removeButton.textContent = 'x';

    pill.appendChild(text);
    pill.appendChild(removeButton);
    elements.bookmarkTagPills.appendChild(pill);
  });
}

function setTagList(tags) {
  state.tagList = normalizeTags(tags);
  renderTagPills();
}

function commitTagDraft() {
  const rawDraft = elements.bookmarkTagInput.value || '';
  const pendingTags = rawDraft
    .split(/[\s,]+/)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);

  if (pendingTags.length === 0) {
    return true;
  }

  const invalidTag = pendingTags.find((tag) => /\s/.test(tag));
  if (invalidTag) {
    showMessage('error', `Tags must be single words. Invalid tag: ${invalidTag}`);
    return false;
  }

  setTagList([...state.tagList, ...pendingTags]);
  elements.bookmarkTagInput.value = '';
  return true;
}

function getClient() {
  return createTagstashClient({
    apiBaseUrl: state.apiBaseUrl,
    token: state.token,
  });
}

async function loadAllTagNames() {
  try {
    const response = await getClient().getAllTags();
    state.allTagNames = (response.tags || [])
      .map((t) => (t.name || t).trim().toLowerCase())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    state.allTagNames = [];
  }
}

async function hydrateActiveTab() {
  const [tab] = await browserApi.tabs.query({ active: true, currentWindow: true });
  state.activeTab = tab || null;

  if (!tab || !isSupportedUrl(tab.url)) {
    elements.tabTitle.textContent = 'Open an http or https page to save it';
    elements.tabUrl.textContent = tab?.url || 'Browser internal pages cannot be saved from the popup.';
    elements.bookmarkTitle.value = '';
    elements.bookmarkUrl.value = '';
    elements.bookmarkDescription.value = '';
    setTagList([]);
    elements.bookmarkTagInput.value = '';
    return;
  }

  elements.tabTitle.textContent = tab.title || 'Untitled tab';
  elements.tabUrl.textContent = tab.url;
  elements.bookmarkTitle.value = tab.title || '';
  elements.bookmarkUrl.value = tab.url || '';
}

async function restoreSession() {
  const settings = await getSettings();
  state.apiBaseUrl = settings.apiBaseUrl;
  state.token = settings.token;
  state.user = settings.user;
  themeApi.applyUserTheme(state.user);

  if (!state.token) {
    toggleView(false);
    return;
  }

  try {
    const response = await getClient().getCurrentUser();
    state.user = response.user;
    themeApi.applyUserTheme(response.user);
    elements.userLabel.textContent = response.user.username;
    toggleView(true);
  } catch {
    await clearSession();
    state.token = null;
    state.user = null;
    toggleView(false);
    showMessage('error', 'Your session expired. Sign in again.');
  }
}

async function handleLogin(event) {
  event.preventDefault();
  clearMessage();
  setBusy(elements.loginButton, true, 'Signing in...');

  try {
    const response = await createTagstashClient({ apiBaseUrl: state.apiBaseUrl }).login(
      elements.email.value.trim(),
      elements.password.value
    );

    state.token = response.token;
    state.user = response.user;
    await saveSession(response.token, response.user);
    themeApi.applyUserTheme(response.user);
    elements.userLabel.textContent = response.user.username;
    elements.password.value = '';
    toggleView(true);
    await loadAllTagNames();
    showMessage('success', 'Signed in. Save the current tab when ready.');
  } catch (error) {
    showMessage('error', error.message || 'Unable to sign in');
  } finally {
    setBusy(elements.loginButton, false);
  }
}

async function handleLogout() {
  await clearSession();
  state.token = null;
  state.user = null;
  toggleView(false);
  clearMessage();
}

async function readFromTab() {
  if (!state.activeTab?.id) return null;
  const results = await browserApi.scripting.executeScript({
    target: { tabId: state.activeTab.id },
    func: () => {
      const getMeta = (selector) => {
        const el = document.querySelector(selector);
        return el ? (el.getAttribute('content') || '').trim() || null : null;
      };
      return {
        title: document.title?.trim() || null,
        description:
          getMeta('meta[name="description"]') ||
          getMeta('meta[property="og:description"]') ||
          getMeta('meta[name="twitter:description"]') ||
          null,
      };
    },
  });
  return results?.[0]?.result || null;
}

async function handleFetchTitle() {
  clearMessage();
  setBusy(elements.fetchTitleButton, true, 'Fetching...');
  try {
    const dom = await readFromTab();
    if (dom?.title) {
      elements.bookmarkTitle.value = dom.title;
      return;
    }
    const url = elements.bookmarkUrl.value.trim();
    const normalizedUrl = normalizeBookmarkUrl(url);
    if (!isSupportedUrl(normalizedUrl)) {
      showMessage('error', 'Enter a valid URL first.');
      return;
    }
    const response = await getClient().fetchMetadata(normalizedUrl);
    if (response.title) elements.bookmarkTitle.value = response.title;
    else showMessage('error', 'No title found for this page.');
  } catch (error) {
    showMessage('error', error.message || 'Unable to fetch title');
  } finally {
    setBusy(elements.fetchTitleButton, false);
  }
}

async function handleFetchDescription() {
  clearMessage();
  setBusy(elements.fetchDescriptionButton, true, 'Fetching...');
  try {
    const dom = await readFromTab();
    if (dom?.description) {
      elements.bookmarkDescription.value = dom.description;
      return;
    }
    const url = elements.bookmarkUrl.value.trim();
    const normalizedUrl = normalizeBookmarkUrl(url);
    if (!isSupportedUrl(normalizedUrl)) {
      showMessage('error', 'Enter a valid URL first.');
      return;
    }
    const response = await getClient().fetchMetadata(normalizedUrl);
    if (response.description) elements.bookmarkDescription.value = response.description;
    else showMessage('error', 'No description found for this page.');
  } catch (error) {
    showMessage('error', error.message || 'Unable to fetch description');
  } finally {
    setBusy(elements.fetchDescriptionButton, false);
  }
}

function handleBaseUrl() {
  try {
    const u = new URL(normalizeBookmarkUrl(elements.bookmarkUrl.value));
    elements.bookmarkUrl.value = `${u.origin}/`;
  } catch {}
}

function handleTrimUrl() {
  try {
    const u = new URL(normalizeBookmarkUrl(elements.bookmarkUrl.value));
    elements.bookmarkUrl.value = u.origin + u.pathname;
  } catch {}
}

function handleOpenSidebar() {
  const windowId = state.activeTab?.windowId;
  if (!browserApi.sidePanel || windowId == null) return;

  browserApi.sidePanel
    .open({ windowId })
    .then(() => window.close())
    .catch(() => showMessage('error', 'Unable to open sidebar'));
}

async function checkExistingBookmark() {
  const normalizedUrl = normalizeBookmarkUrl(elements.bookmarkUrl.value.trim());
  if (!normalizedUrl || !isSupportedUrl(normalizedUrl)) return;

  try {
    const result = await getClient().findByUrl(normalizedUrl);
    const { id, title, description, tags } = result.bookmark;
    state.existingBookmarkId = id;
    elements.bookmarkTitle.value = title || '';
    elements.bookmarkDescription.value = description || '';
    setTagList((tags || []).map((t) => t.name));
    elements.bookmarkTagInput.value = '';
    elements.saveButton.textContent = 'Update Bookmark';
  } catch {
    // 404 = not yet saved, or network error — treat as new
    state.existingBookmarkId = null;
    setTagList([]);
    elements.bookmarkTagInput.value = '';
  }
}

async function handleSaveBookmark(event) {
  event.preventDefault();
  clearMessage();

  if (!commitTagDraft()) {
    return;
  }

  const bookmark = {
    title: elements.bookmarkTitle.value.trim(),
    url: normalizeBookmarkUrl(elements.bookmarkUrl.value.trim()),
    description: elements.bookmarkDescription.value.trim(),
    tags: state.tagList,
  };

  if (!bookmark.title || !bookmark.url) {
    showMessage('error', 'Title and URL are required.');
    return;
  }

  if (!isSupportedUrl(bookmark.url)) {
    showMessage('error', 'Only http and https URLs can be saved.');
    return;
  }

  setBusy(elements.saveButton, true, 'Saving...');

  try {
    if (state.existingBookmarkId) {
      await getClient().updateBookmark(state.existingBookmarkId, bookmark);
    } else {
      await getClient().createBookmark(bookmark);
    }
    window.close();
  } catch (error) {
    showMessage('error', error.message || 'Unable to save bookmark');
  } finally {
    setBusy(elements.saveButton, false);
  }
}

function getSuggestedTag(draft) {
  const normalized = draft.trim().toLowerCase();
  if (!normalized) return null;

  const lockedSet = new Set(state.tagList);

  const exact = state.allTagNames.find((t) => t === normalized && !lockedSet.has(t));
  if (exact) return exact;

  return state.allTagNames.find((t) => t.startsWith(normalized) && !lockedSet.has(t)) || null;
}

function updateTagSuggestion() {
  const draft = elements.bookmarkTagInput.value || '';
  const suggestion = getSuggestedTag(draft);
  if (suggestion) {
    elements.tagInputSuggestion.hidden = false;
    elements.tagInputSuggestion.querySelector('strong').textContent = suggestion;
  } else {
    elements.tagInputSuggestion.hidden = true;
  }
}

function handleTagInputKeyDown(event) {
  if (event.key === 'Tab') {
    const draft = elements.bookmarkTagInput.value || '';
    const suggestion = getSuggestedTag(draft);
    if (suggestion) {
      event.preventDefault();
      clearMessage();
      elements.bookmarkTagInput.value = suggestion;
      commitTagDraft();
      updateTagSuggestion();
    }
    return;
  }

  const isDelimiter = event.key === ',' || event.key === ' ' || event.key === 'Spacebar';
  if (isDelimiter && elements.bookmarkTagInput.value.trim()) {
    event.preventDefault();
    clearMessage();
    commitTagDraft();
    updateTagSuggestion();
    return;
  }

  if (event.key === 'Backspace' && !elements.bookmarkTagInput.value && state.tagList.length > 0) {
    event.preventDefault();
    setTagList(state.tagList.slice(0, -1));
  }
}

function handleTagPillClick(event) {
  const removeBtn = event.target.closest('.tag-pill-remove');
  if (!removeBtn) return;
  const index = Number(removeBtn.dataset.index);
  if (!Number.isInteger(index)) return;

  setTagList(state.tagList.filter((_, i) => i !== index));
}

async function init() {
  await hydrateActiveTab();
  await restoreSession();

  if (state.token) {
    await checkExistingBookmark();
    await loadAllTagNames();
  }

  if (browserApi.sidePanel && state.activeTab?.windowId != null) {
    elements.openSidebarButton.hidden = false;
    elements.openSidebarButton.addEventListener('click', handleOpenSidebar);
  }

  elements.loginForm.addEventListener('submit', handleLogin);
  elements.logoutButton.addEventListener('click', handleLogout);
  elements.fetchTitleButton.addEventListener('click', handleFetchTitle);
  elements.fetchDescriptionButton.addEventListener('click', handleFetchDescription);
  elements.baseUrlButton.addEventListener('click', handleBaseUrl);
  elements.trimUrlButton.addEventListener('click', handleTrimUrl);
  elements.bookmarkTagInput.addEventListener('keydown', handleTagInputKeyDown);
  elements.bookmarkTagInput.addEventListener('input', updateTagSuggestion);
  elements.bookmarkTagInput.addEventListener('blur', commitTagDraft);
  elements.bookmarkTagPills.addEventListener('click', handleTagPillClick);
  elements.bookmarkForm.addEventListener('submit', handleSaveBookmark);
}

init().catch((error) => {
  showMessage('error', error.message || 'Extension failed to initialize');
});
