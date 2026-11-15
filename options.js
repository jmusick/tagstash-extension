import { DEFAULT_API_BASE_URL, getSettings, saveApiBaseUrl, clearSession } from './lib/storage.js';

const browserApi = globalThis.browser ?? globalThis.chrome;

const elements = {
  form: document.getElementById('settingsForm'),
  apiBaseUrl: document.getElementById('apiBaseUrl'),
  saveButton: document.getElementById('saveSettingsButton'),
  statusMessage: document.getElementById('statusMessage'),
};

function normalizeApiBaseUrl(value) {
  const trimmedValue = value.trim();
  const normalizedValue = trimmedValue.replace(/\/+$/, '');
  return normalizedValue || DEFAULT_API_BASE_URL;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

// Bearer tokens travel with every request, so the endpoint must be HTTPS.
// Plain HTTP is allowed only for loopback development servers. Returns an
// error message, or null when the URL is acceptable.
function validateApiBaseUrl(parsed) {
  if (parsed.username || parsed.password) {
    return 'Remove the user name and password from the URL. Sign in from the popup instead.';
  }
  if (parsed.protocol === 'https:') return null;
  if (parsed.protocol === 'http:') {
    return isLoopbackHost(parsed.hostname)
      ? null
      : 'Use an https:// URL. Plain http:// is only allowed for localhost development servers.';
  }
  return 'Use an https:// URL, for example https://tagsta.sh/api';
}

function showStatus(message, { error = false } = {}) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle('is-error', error);
}

async function loadSettings() {
  const settings = await getSettings();
  elements.apiBaseUrl.value = settings.apiBaseUrl;
}

async function handleSubmit(event) {
  event.preventDefault();
  elements.saveButton.disabled = true;

  showStatus('');

  try {
    const apiBaseUrl = normalizeApiBaseUrl(elements.apiBaseUrl.value);
    let parsed;
    try {
      parsed = new URL(apiBaseUrl);
    } catch {
      showStatus('Enter a valid API base URL, for example https://tagsta.sh/api', { error: true });
      return;
    }

    // Validate before asking for permission or touching storage, so a rejected
    // URL keeps the old endpoint and the current session.
    const validationError = validateApiBaseUrl(parsed);
    if (validationError) {
      showStatus(validationError, { error: true });
      return;
    }

    const origin = `${parsed.protocol}//${parsed.host}/*`;

    const granted = await browserApi.permissions.request({ origins: [origin] });
    if (!granted) {
      showStatus('Permission denied — the extension needs access to that URL to save bookmarks.', { error: true });
      return;
    }

    await saveApiBaseUrl(apiBaseUrl);
    await clearSession();
    showStatus('Settings saved. Sign in again in the popup.');
  } catch {
    showStatus('Could not save settings. Try again.', { error: true });
  } finally {
    elements.saveButton.disabled = false;
  }
}

const dashboardUrl = browserApi.runtime.getURL('dashboard.html');
const dashboardInput = document.getElementById('dashboardUrl');
const copyDashboardButton = document.getElementById('copyDashboardButton');
dashboardInput.value = dashboardUrl;
dashboardInput.addEventListener('focus', () => dashboardInput.select());
copyDashboardButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(dashboardUrl);
    copyDashboardButton.textContent = 'Copied';
  } catch {
    dashboardInput.select();
    copyDashboardButton.textContent = 'Press Ctrl+C';
  }
  setTimeout(() => { copyDashboardButton.textContent = 'Copy'; }, 2000);
});

loadSettings();
elements.form.addEventListener('submit', handleSubmit);
