import { createTagstashClient, isAuthError } from './lib/tagstash-client.js';
import { createEditModal } from './lib/edit-modal.js';
import { clearSession, getHomeCache, getSettings, saveHomeCache } from './lib/storage.js';

const browserApi = globalThis.browser ?? globalThis.chrome;
// Set up by lib/theme.js, loaded as a classic script in dashboard.html's <head>.
const themeApi = globalThis.tagstashTheme;

// Tag cards show this many bookmarks before a "Show more" toggle, so one huge
// tag doesn't push every other card off the screen.
const CARD_PREVIEW_LIMIT = 10;
// Refetch when the tab comes back into view and the data is older than this.
const STALE_AFTER_MS = 5 * 60 * 1000;

document.querySelectorAll('[data-version]').forEach((el) => {
  el.textContent = `v${browserApi.runtime.getManifest().version}`;
});

// Signing in or out in the popup reloads the page into the matching state.
browserApi.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes['tagstash.token']) {
    location.reload();
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  const content = document.getElementById('dash-content');
  const notLoggedIn = document.getElementById('not-logged-in');
  const loadError = document.getElementById('load-error');
  const loadErrorText = document.getElementById('load-error-text');
  const searchRow = document.getElementById('dash-search');
  const searchInput = document.getElementById('search-input');
  const sortToggle = document.getElementById('sort-toggle');
  const refreshBtn = document.getElementById('refresh-btn');
  const brandLink = document.getElementById('brand-link');

  const settings = await getSettings();
  themeApi.applyUserTheme(settings.user);

  // Point the logo at the instance the extension is configured for.
  try {
    brandLink.href = new URL(settings.apiBaseUrl.replace(/\/api\/?$/, '/')).href;
  } catch {
    // Keep the tagsta.sh default.
  }

  if (!settings.token) {
    searchRow.hidden = true;
    sortToggle.hidden = true;
    refreshBtn.hidden = true;
    notLoggedIn.hidden = false;
    return;
  }

  const client = createTagstashClient({
    apiBaseUrl: settings.apiBaseUrl,
    token: settings.token,
  });

  // Same rule as the sidebar: only a rejected token signs the user out.
  async function handleAuthFailure(error) {
    if (!isAuthError(error)) return false;
    await clearSession();
    return true;
  }

  const editModal = createEditModal({
    fetchMetadata: (url) => client.fetchMetadata(url),
    save: async (id, data) => {
      await client.updateBookmark(id, data);
      loadData();
    },
  });

  // Keep the theme in step with the account, as the sidebar does.
  client
    .getCurrentUser()
    .then((response) => themeApi.applyUserTheme(response.user))
    .catch(handleAuthFailure);

  let sortMode = localStorage.getItem('dashboardSortMode') === 'alpha' ? 'alpha' : 'count';
  // Off by default: the page is for starred items first.
  let showOtherTags = localStorage.getItem('dashboardShowOtherTags') === 'true';
  let tags = [];
  let allBookmarks = [];
  let bookmarksByTag = new Map();
  let lastLoadedAt = 0;
  let searchTerm = '';
  // Tag names whose cards the user expanded past the preview limit.
  const expandedTags = new Set();

  const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '');

  // Each tag card sorts its own bookmarks. Dates are newest first; the API
  // returns SQLite "YYYY-MM-DD HH:MM:SS" timestamps, which sort as strings.
  // updated_at also moves when a bookmark is starred or made private.
  const TAG_SORTS = [
    { key: 'alpha', label: 'A–Z', title: 'Sort by title' },
    { key: 'added', label: 'Added', title: 'Newest added first' },
    { key: 'updated', label: 'Updated', title: 'Recently updated first' },
  ];
  const byDate = (field) => (a, b) =>
    (b[field] || '').localeCompare(a[field] || '') || byTitle(a, b);
  const TAG_SORT_COMPARATORS = {
    alpha: byTitle,
    added: byDate('created_at'),
    updated: byDate('updated_at'),
  };

  let tagSorts = {};
  try {
    tagSorts = JSON.parse(localStorage.getItem('dashboardTagSorts')) || {};
  } catch {
    // Corrupt or missing; every tag falls back to A–Z.
  }

  function getTagSort(tagName) {
    return TAG_SORT_COMPARATORS[tagSorts[tagName]] ? tagSorts[tagName] : 'alpha';
  }

  function setTagSort(tagName, key) {
    if (key === 'alpha') delete tagSorts[tagName];
    else tagSorts[tagName] = key;
    localStorage.setItem('dashboardTagSorts', JSON.stringify(tagSorts));
  }

  // Starred bookmarks get the same three sorts, stored separately so no tag
  // name can collide with it.
  let starredSort = TAG_SORT_COMPARATORS[localStorage.getItem('dashboardStarredSort')]
    ? localStorage.getItem('dashboardStarredSort')
    : 'alpha';

  function buildSortToggle(currentKey, ariaLabel, onSelect) {
    const group = document.createElement('div');
    group.className = 'tag-sort';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', ariaLabel);
    for (const option of TAG_SORTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-sort-btn';
      btn.textContent = option.label;
      btn.title = option.title;
      btn.setAttribute('aria-pressed', String(option.key === currentKey));
      btn.addEventListener('click', () => {
        if (option.key !== currentKey) onSelect(option.key);
      });
      group.appendChild(btn);
    }
    return group;
  }

  function setData(nextTags, nextBookmarks) {
    tags = nextTags || [];
    allBookmarks = nextBookmarks || [];
    bookmarksByTag = new Map();
    for (const bookmark of allBookmarks) {
      for (const tag of (bookmark.tags || [])) {
        const name = tag.name || tag;
        if (!bookmarksByTag.has(name)) bookmarksByTag.set(name, []);
        bookmarksByTag.get(name).push(bookmark);
      }
    }
  }

  function matchesSearch(bookmark, term) {
    const tagsText = (bookmark.tags || []).map(t => t.name || t).join(' ');
    return [bookmark.title, bookmark.url, bookmark.description, tagsText]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(term);
  }

  function getSortedTags(tagList) {
    const sorted = [...tagList];
    if (sortMode === 'alpha') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }
    return sorted;
  }

  function hostnameOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  function buildFavicon(url, size) {
    const host = hostnameOf(url);
    if (!host) return null;
    const img = document.createElement('img');
    img.src = `https://icons.duckduckgo.com/ip3/${host}.ico`;
    img.className = 'favicon';
    img.width = size;
    img.height = size;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    return img;
  }

  function buildEditButton(bookmark, className) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = 'Edit';
    btn.title = 'Edit bookmark';
    btn.setAttribute('aria-label', `Edit ${bookmark.title || bookmark.url}`);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      editModal.open(bookmark);
    });
    return btn;
  }

  // Plain links, so a click navigates this tab and middle/ctrl-click opens a
  // new one, like any start page.
  function buildBookmarkLink(bookmark) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'bm-link';
    link.href = bookmark.url;
    link.rel = 'noopener noreferrer';
    link.title = bookmark.description ? `${bookmark.url}\n\n${bookmark.description}` : bookmark.url;

    const icon = buildFavicon(bookmark.url, 16);
    if (icon) link.appendChild(icon);

    const title = document.createElement('span');
    title.className = 'bm-title';
    title.textContent = bookmark.title || bookmark.url;
    link.appendChild(title);

    li.className = 'bm-item';
    li.appendChild(link);
    li.appendChild(buildEditButton(bookmark, 'bm-edit-btn'));
    return li;
  }

  function buildStarredTile(bookmark) {
    // The edit button can't live inside the <a>, so the tile is a wrapper.
    const tile = document.createElement('div');
    tile.className = 'star-tile-wrap';
    const link = document.createElement('a');
    link.className = 'star-tile';
    link.href = bookmark.url;
    link.rel = 'noopener noreferrer';
    link.title = bookmark.url;

    const icon = buildFavicon(bookmark.url, 20);
    if (icon) link.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'star-tile-text';
    const title = document.createElement('span');
    title.className = 'star-tile-title';
    title.textContent = bookmark.title || bookmark.url;
    const host = document.createElement('span');
    host.className = 'star-tile-host';
    host.textContent = hostnameOf(bookmark.url);
    text.append(title, host);
    link.appendChild(text);

    tile.appendChild(link);
    tile.appendChild(buildEditButton(bookmark, 'bm-edit-btn star-tile-edit'));
    return tile;
  }

  // `controls` (optional) sits at the right end of the heading row.
  function buildSection(heading, count, starred = false, controls = null) {
    const section = document.createElement('section');
    section.className = 'dash-section';
    const h2 = document.createElement('h2');
    h2.className = 'section-heading';
    if (starred) {
      const star = document.createElement('span');
      star.className = 'star-glyph';
      star.textContent = '★';
      h2.appendChild(star);
    }
    h2.append(heading);
    const countEl = document.createElement('span');
    countEl.className = 'section-count';
    countEl.textContent = count;
    h2.appendChild(countEl);
    if (controls) {
      const row = document.createElement('div');
      row.className = 'section-header';
      row.append(h2, controls);
      section.appendChild(row);
    } else {
      section.appendChild(h2);
    }
    return section;
  }

  function buildTagCard(tag, starred) {
    const card = document.createElement('article');
    card.className = 'tag-card';
    if (starred) card.classList.add('tag-card--starred');

    const header = document.createElement('header');
    header.className = 'tag-card-header';

    const label = document.createElement('span');
    label.className = 'tag-stock tag-card-label';
    const labelText = document.createElement('span');
    labelText.className = 'tag-card-label-text';
    labelText.textContent = tag.name;
    label.appendChild(labelText);
    if (starred) {
      const star = document.createElement('span');
      star.className = 'star-glyph';
      star.textContent = '★';
      label.appendChild(star);
    }
    header.appendChild(label);

    const sortKey = getTagSort(tag.name);
    const bookmarks = (bookmarksByTag.get(tag.name) || []).slice().sort(TAG_SORT_COMPARATORS[sortKey]);

    header.appendChild(buildSortToggle(sortKey, `Sort ${tag.name} bookmarks`, (key) => {
      setTagSort(tag.name, key);
      const next = buildTagCard(tag, starred);
      card.replaceWith(next);
      next.querySelector('.tag-sort-btn[aria-pressed="true"]')?.focus();
    }));

    const count = document.createElement('span');
    count.className = 'tag-count';
    count.textContent = bookmarks.length;
    header.appendChild(count);
    card.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'bm-list';
    const expanded = expandedTags.has(tag.name);
    const visible = expanded ? bookmarks : bookmarks.slice(0, CARD_PREVIEW_LIMIT);
    for (const bookmark of visible) list.appendChild(buildBookmarkLink(bookmark));
    card.appendChild(list);

    if (bookmarks.length > CARD_PREVIEW_LIMIT) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'text-btn tag-card-more';
      more.textContent = expanded ? 'Show less' : `Show ${bookmarks.length - CARD_PREVIEW_LIMIT} more`;
      more.addEventListener('click', () => {
        if (expanded) expandedTags.delete(tag.name);
        else expandedTags.add(tag.name);
        card.replaceWith(buildTagCard(tag, starred));
      });
      card.appendChild(more);
    }

    return card;
  }

  function buildTagGrid(tagList, starred) {
    const grid = document.createElement('div');
    grid.className = 'tag-grid';
    for (const tag of getSortedTags(tagList)) {
      // The tag list can include tags whose bookmarks were all deleted.
      if (!bookmarksByTag.has(tag.name)) continue;
      grid.appendChild(buildTagCard(tag, starred));
    }
    return grid;
  }

  function buildEmptyState(text) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = text;
    return empty;
  }

  function buildOtherTagsToggle(count) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section-heading section-toggle';
    btn.setAttribute('aria-expanded', String(showOtherTags));

    const arrow = document.createElement('span');
    arrow.className = 'section-toggle-arrow';
    arrow.textContent = '▶';
    btn.appendChild(arrow);
    btn.append(showOtherTags ? 'Hide other tags' : 'Show other tags');

    const countEl = document.createElement('span');
    countEl.className = 'section-count';
    countEl.textContent = count;
    btn.appendChild(countEl);

    btn.addEventListener('click', () => {
      showOtherTags = !showOtherTags;
      localStorage.setItem('dashboardShowOtherTags', String(showOtherTags));
      render();
      // render() replaced the button; keep keyboard focus on its replacement.
      content.querySelector('.section-toggle')?.focus();
    });
    return btn;
  }

  function renderSearch() {
    const matches = allBookmarks.filter(b => matchesSearch(b, searchTerm)).sort(byTitle);
    const section = buildSection('Results', matches.length);
    if (matches.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No bookmarks match your search.';
      section.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'bm-list bm-list--results';
      for (const bookmark of matches) list.appendChild(buildBookmarkLink(bookmark));
      section.appendChild(list);
    }
    content.replaceChildren(section);
  }

  function render() {
    if (searchTerm) {
      renderSearch();
      return;
    }

    const starredBookmarks = allBookmarks.filter(b => Boolean(b.is_favorite)).sort(TAG_SORT_COMPARATORS[starredSort]);
    const starredTags = tags.filter(t => Boolean(t.is_favorite) && bookmarksByTag.has(t.name));
    const otherTags = tags.filter(t => !t.is_favorite && bookmarksByTag.has(t.name));
    const sections = [];

    if (starredBookmarks.length > 0) {
      const sortToggle = buildSortToggle(starredSort, 'Sort starred bookmarks', (key) => {
        starredSort = key;
        localStorage.setItem('dashboardStarredSort', key);
        render();
        content.querySelector('.section-header .tag-sort-btn[aria-pressed="true"]')?.focus();
      });
      const section = buildSection('Starred bookmarks', starredBookmarks.length, true, sortToggle);
      const grid = document.createElement('div');
      grid.className = 'star-grid';
      for (const bookmark of starredBookmarks) grid.appendChild(buildStarredTile(bookmark));
      section.appendChild(grid);
      sections.push(section);
    }

    if (starredTags.length > 0) {
      const section = buildSection('Starred tags', starredTags.length, true);
      section.appendChild(buildTagGrid(starredTags, true));
      sections.push(section);
    }

    if (allBookmarks.length === 0) {
      sections.push(buildEmptyState('No bookmarks yet. Save some with the Tagstash toolbar button.'));
    } else if (sections.length === 0) {
      sections.push(buildEmptyState('Star bookmarks or tags in Tagstash to pin them here.'));
    }

    // The page is a quick launcher for starred items, so the rest of the
    // library stays behind a toggle that's off until the user opens it.
    if (otherTags.length > 0) {
      const section = document.createElement('section');
      section.className = 'dash-section';
      section.appendChild(buildOtherTagsToggle(otherTags.length));
      if (showOtherTags) section.appendChild(buildTagGrid(otherTags, false));
      sections.push(section);
    }

    content.replaceChildren(...sections);
  }

  async function loadData() {
    refreshBtn.classList.add('spinning');
    try {
      const [tagsResponse, bookmarksResponse] = await Promise.all([
        client.getAllTags(),
        client.getBookmarks(),
      ]);
      setData(tagsResponse.tags, bookmarksResponse.bookmarks);
      lastLoadedAt = Date.now();
      loadError.hidden = true;
      render();
      saveHomeCache(tags, allBookmarks).catch(() => {
        // Caching is best-effort; the next visit just waits for the network.
      });
    } catch (error) {
      if (await handleAuthFailure(error)) return;
      console.error('Error loading Tagstash data:', error);
      loadErrorText.textContent = allBookmarks.length > 0
        ? "Couldn't reach Tagstash. Showing your last saved copy."
        : "Couldn't reach Tagstash.";
      loadError.hidden = false;
    } finally {
      refreshBtn.classList.remove('spinning');
    }
  }

  // Search
  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    render();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchTerm = '';
      render();
      searchInput.blur();
    }
    // Enter opens the top result, so the page doubles as a launcher.
    if (e.key === 'Enter' && searchTerm) {
      const first = content.querySelector('.bm-link');
      if (first) first.click();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || editModal.isOpen()) return;
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    e.preventDefault();
    searchInput.focus();
  });

  // Sort
  sortToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.sort-btn');
    if (!btn || btn.dataset.sort === sortMode) return;
    sortMode = btn.dataset.sort;
    localStorage.setItem('dashboardSortMode', sortMode);
    sortToggle.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === sortMode));
    render();
  });
  sortToggle.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === sortMode));

  refreshBtn.addEventListener('click', loadData);
  document.getElementById('retry-btn').addEventListener('click', loadData);

  // A start page tab can sit open for hours; refresh when the user comes back to it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastLoadedAt > STALE_AFTER_MS) {
      loadData();
    }
  });

  // Paint the cached copy right away, then refresh from the API.
  const cache = await getHomeCache().catch(() => null);
  if (cache) {
    setData(cache.tags, cache.bookmarks);
    render();
  }
  loadData();
});
