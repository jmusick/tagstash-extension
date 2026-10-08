// Edit-bookmark dialog shared by the sidebar and the dashboard. Styles live in
// edit-modal.css, which each page links alongside its own stylesheet.
//
// createEditModal({ save, fetchMetadata }) adds the dialog to the page and
// returns { open, isOpen }. `save(id, data)` should persist the edit (and
// refresh the page's data); if it throws, the dialog stays open and shows the
// error. `fetchMetadata(url)` is the client's POST /bookmarks/meta call, used by
// the Fetch Title / Fetch From Site buttons.
//
// The field helper buttons match the popup and the website's edit form, minus
// the icons and the "i" tooltips, to keep the dialog compact.

import { isSupportedUrl, normalizeBookmarkUrl, toBaseUrl, toTrimmedUrl } from './bookmark-url.js';

const MARKUP = `
  <div class="edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-modal-heading">
    <div class="edit-modal-header">
      <h2 id="edit-modal-heading">Edit Bookmark</h2>
      <button id="edit-close" class="edit-close-btn" type="button" aria-label="Close">✕</button>
    </div>
    <form id="edit-form">
      <div class="edit-field">
        <div class="edit-field-header">
          <label for="edit-title">Title</label>
          <div class="edit-field-actions">
            <button type="button" id="edit-fetch-title" class="edit-field-action" title="Replace the title with the page's own title">Fetch Title</button>
          </div>
        </div>
        <input id="edit-title" type="text" required />
      </div>
      <div class="edit-field">
        <div class="edit-field-header">
          <label for="edit-url">URL</label>
          <div class="edit-field-actions" id="edit-url-actions">
            <a id="edit-open-url" class="edit-field-action" target="_blank" rel="noopener noreferrer" title="Open this URL in a new tab">Open</a>
            <button type="button" id="edit-base-url" class="edit-field-action" title="Keep only the site root, e.g. https://example.com/">Base URL</button>
            <button type="button" id="edit-trim-url" class="edit-field-action" title="Remove the query string and #fragment, keep the path">Trim URL</button>
          </div>
        </div>
        <input id="edit-url" type="url" required />
      </div>
      <div class="edit-field">
        <div class="edit-field-header">
          <label for="edit-desc">Description</label>
          <div class="edit-field-actions">
            <button type="button" id="edit-fetch-desc" class="edit-field-action" title="Fill the description from the page's metadata">Fetch From Site</button>
          </div>
        </div>
        <textarea id="edit-desc" rows="2"></textarea>
      </div>
      <div class="edit-field">
        <label for="edit-tags">Tags</label>
        <div class="edit-tag-shell" id="edit-tags-field">
          <div id="edit-tag-pills" class="edit-tag-pill-list"></div>
          <input id="edit-tags" type="text" placeholder="Type tag, press comma" autocomplete="off" />
        </div>
        <small class="edit-tags-hint">Comma or Space to add &middot; Backspace to remove last</small>
      </div>
      <div id="edit-error" class="edit-error" hidden></div>
      <div class="edit-modal-actions">
        <button type="button" id="edit-cancel" class="edit-cancel-btn">Cancel</button>
        <button type="submit" id="edit-save" class="edit-save-btn">Save</button>
      </div>
    </form>
  </div>
`;

export function createEditModal({ save, fetchMetadata }) {
  const overlay = document.createElement('div');
  overlay.id = 'edit-overlay';
  overlay.className = 'edit-overlay';
  overlay.hidden = true;
  // Static markup with no interpolated values; bookmark data is only ever
  // written through .value / .textContent below.
  overlay.innerHTML = MARKUP;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('#edit-form');
  const titleInput = overlay.querySelector('#edit-title');
  const urlInput = overlay.querySelector('#edit-url');
  const descInput = overlay.querySelector('#edit-desc');
  const tagsField = overlay.querySelector('#edit-tags-field');
  const tagPillsEl = overlay.querySelector('#edit-tag-pills');
  const tagInput = overlay.querySelector('#edit-tags');
  const errorEl = overlay.querySelector('#edit-error');
  const saveBtn = overlay.querySelector('#edit-save');
  const fetchTitleBtn = overlay.querySelector('#edit-fetch-title');
  const fetchDescBtn = overlay.querySelector('#edit-fetch-desc');
  const urlActions = overlay.querySelector('#edit-url-actions');
  const openUrlLink = overlay.querySelector('#edit-open-url');

  let editingBookmarkId = null;
  let tagList = [];
  let returnFocusTo = null;

  function normalizeTags(arr) {
    return Array.from(new Set(arr.map(t => t.trim().toLowerCase()).filter(Boolean)));
  }

  function renderTagPills() {
    tagPillsEl.innerHTML = '';
    tagList.forEach((tag, index) => {
      const pill = document.createElement('span');
      pill.className = 'edit-tag-pill tag-stock';

      const text = document.createElement('span');
      text.textContent = tag;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'edit-tag-pill-remove';
      removeBtn.setAttribute('aria-label', `Remove tag ${tag}`);
      removeBtn.textContent = '\xd7';
      removeBtn.addEventListener('click', () => {
        tagList.splice(index, 1);
        renderTagPills();
      });

      pill.appendChild(text);
      pill.appendChild(removeBtn);
      tagPillsEl.appendChild(pill);
    });
  }

  function setTagList(arr) {
    tagList = normalizeTags(arr);
    renderTagPills();
  }

  function commitTagDraft() {
    const raw = tagInput.value || '';
    const pending = raw.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
    if (pending.length === 0) return;
    setTagList([...tagList, ...pending]);
    tagInput.value = '';
  }

  tagsField.addEventListener('click', () => tagInput.focus());

  tagInput.addEventListener('keydown', (e) => {
    const isDelimiter = e.key === ',' || e.key === ' ' || e.key === 'Spacebar';
    if (isDelimiter && tagInput.value.trim()) {
      e.preventDefault();
      commitTagDraft();
      return;
    }
    if (e.key === 'Backspace' && !tagInput.value && tagList.length > 0) {
      e.preventDefault();
      tagList.pop();
      renderTagPills();
    }
    if (e.key === 'Enter' && tagInput.value.trim()) {
      e.preventDefault();
      commitTagDraft();
    }
  });

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  // URL-dependent helpers only make sense once the field holds something.
  function syncUrlActions() {
    const url = normalizeBookmarkUrl(urlInput.value);
    const usable = isSupportedUrl(url);
    urlActions.hidden = !urlInput.value.trim();
    openUrlLink.href = usable ? url : '#';
    openUrlLink.toggleAttribute('aria-disabled', !usable);
    fetchTitleBtn.disabled = !usable || fetchTitleBtn.dataset.busy === 'true';
    fetchDescBtn.disabled = !usable || fetchDescBtn.dataset.busy === 'true';
  }

  urlInput.addEventListener('input', syncUrlActions);

  openUrlLink.addEventListener('click', (e) => {
    if (openUrlLink.hasAttribute('aria-disabled')) e.preventDefault();
  });

  overlay.querySelector('#edit-base-url').addEventListener('click', () => {
    const next = toBaseUrl(urlInput.value);
    if (next) urlInput.value = next;
    syncUrlActions();
  });

  overlay.querySelector('#edit-trim-url').addEventListener('click', () => {
    const next = toTrimmedUrl(urlInput.value);
    if (next) urlInput.value = next;
    syncUrlActions();
  });

  // Unlike the popup, the bookmark being edited usually isn't the active tab,
  // so these always ask the server rather than reading the page's DOM.
  async function fetchInto(button, field, target, missingMessage) {
    const url = normalizeBookmarkUrl(urlInput.value);
    if (!isSupportedUrl(url)) {
      showError('Enter a valid URL first.');
      return;
    }
    const label = button.textContent;
    const forBookmark = editingBookmarkId;
    button.dataset.busy = 'true';
    button.textContent = 'Fetching…';
    errorEl.hidden = true;
    syncUrlActions();
    try {
      const response = await fetchMetadata(url);
      // Ignore a late answer if the dialog was closed or reopened meanwhile.
      if (editingBookmarkId !== forBookmark) return;
      if (response?.[field]) target.value = response[field];
      else showError(missingMessage);
    } catch (err) {
      if (editingBookmarkId === forBookmark) showError(err.message || missingMessage);
    } finally {
      button.dataset.busy = 'false';
      button.textContent = label;
      syncUrlActions();
    }
  }

  fetchTitleBtn.addEventListener('click', () =>
    fetchInto(fetchTitleBtn, 'title', titleInput, 'No title found for this page.'));
  fetchDescBtn.addEventListener('click', () =>
    fetchInto(fetchDescBtn, 'description', descInput, 'No description found for this page.'));

  function open(bookmark) {
    editingBookmarkId = bookmark.id;
    returnFocusTo = document.activeElement;
    titleInput.value = bookmark.title || '';
    urlInput.value = bookmark.url || '';
    descInput.value = bookmark.description || '';
    setTagList((bookmark.tags || []).map(t => t.name || t));
    tagInput.value = '';
    errorEl.hidden = true;
    syncUrlActions();
    overlay.hidden = false;
    titleInput.focus();
  }

  function close() {
    overlay.hidden = true;
    editingBookmarkId = null;
    // The page may have re-rendered while the dialog was open, so only return
    // focus if the element that opened it is still there.
    if (returnFocusTo?.isConnected) returnFocusTo.focus();
    returnFocusTo = null;
  }

  overlay.querySelector('#edit-close').addEventListener('click', close);
  overlay.querySelector('#edit-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingBookmarkId) return;

    commitTagDraft();

    const data = {
      title: titleInput.value.trim(),
      url: urlInput.value.trim(),
      description: descInput.value.trim(),
      tags: tagList,
    };

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    errorEl.hidden = true;

    try {
      await save(editingBookmarkId, data);
      close();
    } catch (err) {
      errorEl.textContent = err.message || 'Failed to save.';
      errorEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });

  return { open, isOpen: () => !overlay.hidden };
}
