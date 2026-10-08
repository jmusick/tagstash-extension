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

function showStatus(message) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.hidden = false;
}

async function loadSettings() {
  const settings = await getSettings();
  elements.apiBaseUrl.value = settings.apiBaseUrl;
}

async function handleSubmit(event) {
  event.preventDefault();
  elements.saveButton.disabled = true;

  try {
    const apiBaseUrl = normalizeApiBaseUrl(elements.apiBaseUrl.value);
    const parsed = new URL(apiBaseUrl);
    const origin = `${parsed.protocol}//${parsed.host}/*`;

    const granted = await browserApi.permissions.request({ origins: [origin] });
    if (!granted) {
      showStatus('Permission denied — the extension needs access to that URL to save bookmarks.');
      return;
    }

    await saveApiBaseUrl(apiBaseUrl);
    await clearSession();
    showStatus('Settings saved. Sign in again in the popup.');
  } catch {
    showStatus('Enter a valid API base URL, for example https://tagsta.sh/api');
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
