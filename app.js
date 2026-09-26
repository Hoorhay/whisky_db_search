const STORAGE_KEY_DB_URL = 'whisky_tracker_db_url';
const STORAGE_KEY_ACCESS_CODE = 'whisky_tracker_access_code';
// Legacy localStorage cache keys: read once for migration, and used as a fallback if IndexedDB is unavailable
const LEGACY_KEY_CACHE = 'whisky_tracker_cache_data';
const LEGACY_KEY_LAST_SYNC = 'whisky_tracker_last_sync';
const LEGACY_KEY_SYNCED_AT = 'whisky_tracker_synced_at';

const IDB_NAME = 'whisky_db_search';
const IDB_VERSION = 1;
const IDB_STORE = 'cache';
const IDB_RECORD_KEY = 'whiskies';
const FETCH_TIMEOUT_MS = 10000;
// Automatic (non-manual) syncs are skipped if the cache is fresher than this.
// Clicking "Sync DB" always forces a fresh fetch regardless of this.
const AUTO_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000; // 1 day

let rawData = [];
let currentBaseData = [];
let currentFilteredData = [];
let currentSort = { column: null, direction: null };
let fuse = null;

const searchInput = document.getElementById('searchInput');
const clearBtn = document.getElementById('clearBtn');
const resultsBody = document.getElementById('resultsBody');
const statusText = document.getElementById('statusText');
const configBtn = document.getElementById('configBtn');
const syncBtn = document.getElementById('syncBtn');

// Config Modal elements
const configModal = document.getElementById('configModal');
const modalDbUrl = document.getElementById('modalDbUrl');
const modalAccessCode = document.getElementById('modalAccessCode');
const modalSaveBtn = document.getElementById('modalSaveBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalCloseBtn = document.getElementById('modalCloseBtn');

// Detail Modal elements
const detailModal = document.getElementById('detailModal');
const detailContent = document.getElementById('detailContent');
const detailCloseBtn = document.getElementById('detailCloseBtn');

// Scroll to Top Button element
const scrollToTopBtn = document.getElementById('scrollToTopBtn');

// --- IndexedDB cache ---
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(err => {
    dbPromise = null; // allow a retry on the next call
    throw err;
  });
  return dbPromise;
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

// Data and last-sync time are stored as one record, so they can never get out of step.
// syncedAt is a raw epoch ms timestamp (for age checks); lastSync is the display string.
async function saveCache(data, lastSync, syncedAt = Date.now()) {
  try {
    await idbPut(IDB_RECORD_KEY, { data, lastSync, syncedAt });
    try {
      localStorage.removeItem(LEGACY_KEY_CACHE);
      localStorage.removeItem(LEGACY_KEY_LAST_SYNC);
    } catch (e) { /* ignore */ }
    return;
  } catch (err) {
    console.warn('IndexedDB save failed, falling back to localStorage:', err);
  }
  try {
    localStorage.setItem(LEGACY_KEY_CACHE, JSON.stringify(data));
    localStorage.setItem(LEGACY_KEY_LAST_SYNC, lastSync);
    localStorage.setItem(LEGACY_KEY_SYNCED_AT, String(syncedAt));
  } catch (err) {
    console.warn('Could not cache data locally:', err);
  }
}

// Returns { data, lastSync } or null. Never throws.
async function loadCache() {
  try {
    const rec = await idbGet(IDB_RECORD_KEY);
    if (rec && Array.isArray(rec.data) && rec.data.length > 0) return rec;
  } catch (err) {
    console.warn('IndexedDB read failed:', err);
  }

  // Legacy localStorage cache (pre-IndexedDB installs, or IndexedDB unavailable)
  try {
    const cached = localStorage.getItem(LEGACY_KEY_CACHE);
    if (cached) {
      const data = JSON.parse(cached);
      if (Array.isArray(data) && data.length > 0) {
        const storedSyncedAt = Number(localStorage.getItem(LEGACY_KEY_SYNCED_AT));
        const rec = {
          data,
          lastSync: localStorage.getItem(LEGACY_KEY_LAST_SYNC),
          syncedAt: Number.isFinite(storedSyncedAt) && storedSyncedAt > 0 ? storedSyncedAt : 0
        };
        await saveCache(rec.data, rec.lastSync, rec.syncedAt); // migrate; clears legacy keys on success
        return rec;
      }
    }
  } catch (err) {
    console.warn('Failed to read legacy cache:', err);
  }
  return null;
}
// --- end IndexedDB cache ---

// Utility Functions
function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/[&<>'"]/g,
                             tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function openModal() {
  modalDbUrl.value = localStorage.getItem(STORAGE_KEY_DB_URL) || '';
  modalAccessCode.value = localStorage.getItem(STORAGE_KEY_ACCESS_CODE) || '';
  configModal.classList.remove('hidden');
}

function closeModal() {
  configModal.classList.add('hidden');
}

function parseWbCodes(wbVal) {
  if (wbVal === undefined || wbVal === null || wbVal === '') return [];
  return String(wbVal)
  .replace(/\r\n|\r/g, '\n')
  .split('\n')
  .map(code => code.trim())
  .filter(code => code.length > 0);
}

function formatWbLinks(wbVal) {
  const codes = parseWbCodes(wbVal);
  if (codes.length === 0) return '-';

  return codes.map(code => {
    const trimmed = code.trim();
    const cleanCode = code.replace(/\D/g, '');

    // If the code is N/A or contains no digits, display plain text instead of a link
    if (!cleanCode || /^n\/?a$/i.test(trimmed)) {
      return `<span class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-zinc-800 text-zinc-400 border border-zinc-700/50">${escapeHtml(trimmed)}</span>`;
    }

    const displayCode = escapeHtml(code);
    return `<a href="https://www.whiskybase.com/whiskies/whisky/${cleanCode}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 px-2.5 py-1 rounded-md text-xs font-mono font-medium transition border border-amber-500/20">
    WB${displayCode}
    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
    </a>`;
  }).join(' ');
}

function formatWbList(wbVal) {
  const codes = parseWbCodes(wbVal);
  if (codes.length === 0) return '-';
  return escapeHtml(codes.join('\n'));
}

function openDetailModal(item) {
  const formattedYear = item.Year
  ? escapeHtml(String(item.Year).replace(/\r\n|\r/g, '\n'))
  : '-';

  const wbLink = formatWbLinks(item.WBcode);

  const excludedKeys = ['Name', 'ABV', 'Year', 'Score', 'AvgScore', 'WBcode', 'searchableABV', 'YearStr', 'ScoreStr', 'WBcodeStr', 'id'];
  const preferredOrder = ['Nose', 'Nosa', 'Taste', 'Finish'];

  const metadataEntries = Object.entries(item)
  .filter(([k]) => !excludedKeys.includes(k))
  .sort(([a], [b]) => {
    const indexA = preferredOrder.indexOf(a);
    const indexB = preferredOrder.indexOf(b);

    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });

  detailContent.innerHTML = `
  <h2 class="text-xl font-bold text-amber-400 pr-8 leading-snug">${escapeHtml(item.Name || 'Unknown Whisky')}</h2>

  <div class="grid grid-cols-2 gap-3 bg-zinc-950/80 p-4 rounded-xl border border-zinc-800/80">
  <div>
  <span class="block text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-0.5">ABV</span>
  <span class="text-xl font-bold text-zinc-100">${formatAbv(item.ABV)}</span>
  </div>
  <div>
  <span class="block text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">WB Link(s)</span>
  <div class="flex flex-wrap gap-1.5">${wbLink}</div>
  </div>
  <div>
  <span class="block text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-0.5">Year</span>
  <span class="text-sm text-zinc-300 font-medium whitespace-pre-line">${formattedYear}</span>
  </div>
  <div>
  <span class="block text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-0.5">Score</span>
  <span class="text-xl font-bold text-emerald-400">${escapeHtml(String(item.Score || item.AvgScore || '-'))}</span>
  </div>
  </div>

  ${metadataEntries.length > 0 ? `
    <div class="border-t border-zinc-800/80 pt-3 space-y-2.5">
    <h3 class="text-s uppercase tracking-wider text-zinc-400 font-bold">Details & Notes</h3>
    <div class="space-y-2 max-h-48 overflow-y-auto pr-1">
    ${metadataEntries
      .map(([k, v]) => `
      <div class="text-xs bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-800/50">
      <span class="text-amber-500/80 font-medium block mb-0.5">${escapeHtml(k)}</span>
      <span class="text-zinc-300">${escapeHtml(String(v))}</span>
      </div>`)
      .join('')}
      </div>
      </div>
      ` : ''}
      `;

      detailModal.classList.remove('hidden');
}

function closeDetailModal() {
  detailModal.classList.add('hidden');
}

function saveCredentialsAndFetch() {
  const dbUrl = modalDbUrl.value.trim().replace(/\/+$/, '');
  const accessCode = modalAccessCode.value.trim();

  if (dbUrl) localStorage.setItem(STORAGE_KEY_DB_URL, dbUrl);
  if (accessCode) localStorage.setItem(STORAGE_KEY_ACCESS_CODE, accessCode);

  closeModal();
  fetchFreshData();
}

function getStoredCredentials() {
  const dbUrl = localStorage.getItem(STORAGE_KEY_DB_URL);
  const accessCode = localStorage.getItem(STORAGE_KEY_ACCESS_CODE);
  return { dbUrl, accessCode };
}

function getEndpointUrl() {
  const { dbUrl, accessCode } = getStoredCredentials(); // cite: 1
  if (!dbUrl || !accessCode) return null; // cite: 1

  const baseUrl = dbUrl.replace(/\/+$/, '');
  return `${baseUrl}/trackers/whiskies/${encodeURIComponent(accessCode)}.json`;
}

async function fetchFreshData() {
  if (!navigator.onLine) {
    statusText.innerText = "Offline. Displaying cached data.";
    return;
  }

  const endpoint = getEndpointUrl(); // cite: 1

  if (!endpoint) { // cite: 1
    statusText.innerText = "Missing configuration. Click 'Config' to set up credentials."; // cite: 1
    resultsBody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-amber-400 font-medium">Configuration required to fetch data.</td></tr>`; // cite: 1
    openModal(); // cite: 1
    return; // cite: 1
  }

  statusText.innerText = "Syncing with Firebase...";

  // Abort hung requests (dead Wi-Fi / captive portal report navigator.onLine === true)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      signal: controller.signal
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("Unauthorized access. Please check your Access Code.");
    }
    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const data = await response.json();
    if (!data || data.error) {
      throw new Error(data && typeof data.error === 'string' ? data.error : 'Failed to fetch data from database');
    }

    const rawList = Array.isArray(data)
    ? data.flat(Infinity)
    : Object.values(data || {});

    const freshData = rawList.filter(item => item && typeof item === 'object' && item.Name);

    if (freshData.length === 0) {
      throw new Error(rawData.length > 0 ? "Received empty whisky list from database; keeping cached data." : "No whisky records found in database.");
    }

    rawData = freshData;

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear());
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    const nowFormatted = `${hours}:${minutes}, ${day}.${month}.${year}`;

    initSearchAndUI(`Synced now (${nowFormatted}).`);

    // saveCache never throws, so a storage failure can't turn a successful sync into an error
    await saveCache(rawData, nowFormatted, now.getTime());
  } catch (err) {
    console.error(err);
    const isOffline = !navigator.onLine || err.name === 'AbortError' || err instanceof TypeError || (err.message && (err.message.includes('Offline') || err.message.includes('503')));

    if (rawData.length === 0) {
      const rec = await loadCache();
      if (rec) {
        rawData = rec.data;
        const syncInfo = rec.lastSync ? `Cached data (${rec.lastSync}).` : 'Loaded from cache.';
        initSearchAndUI(isOffline ? `Offline. ${syncInfo}` : `Sync failed (${err.message}). ${syncInfo}`);
        return;
      }
    }

    if (isOffline) {
      statusText.innerText = rawData.length > 0
      ? "Offline/Network error. Showing cached data."
      : "Offline. No cached data available.";
    } else {
      statusText.innerText = `Sync failed: ${err.message}`;
      if (rawData.length === 0) {
        resultsBody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-red-400 font-medium">${escapeHtml(err.message)}</td></tr>`;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function loadData() {
  const rec = await loadCache();

  if (rec) {
    rawData = rec.data;
    const syncInfo = rec.lastSync ? `Cached data (${rec.lastSync}).` : 'Loaded from cache.';
    initSearchAndUI(syncInfo);
    return;
  }

  statusText.innerText = "No local cache found. Click 'Sync DB' or 'Config' to download data.";
  resultsBody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-amber-400 font-medium">No cached data available. Tap Sync DB to load whiskies.</td></tr>`;
}

function initSearchAndUI(sourceMessage) {
  const searchableData = rawData.map(item => {
    const cleanAbv = item.ABV !== undefined && item.ABV !== null
    ? String(item.ABV).replace(/%/g, '').replace(',', '.').trim()
    : '';

    return {
      ...item,
      searchableABV: cleanAbv,
      YearStr: item.Year ? String(item.Year) : '',
                                     ScoreStr: item.Score || item.AvgScore ? String(item.Score || item.AvgScore) : '',
                                     WBcodeStr: item.WBcode ? String(item.WBcode) : ''
    };
  });

  fuse = new Fuse(searchableData, {
    keys: [
      { name: 'Name', weight: 0.45 },
      { name: 'YearStr', weight: 0.25 },
      { name: 'searchableABV', weight: 0.2 },
      { name: 'WBcodeStr', weight: 0.1 },
    ],
    threshold: 0.3,
    distance: 100,
    minMatchCharLength: 2,
    ignoreLocation: true,
    useExtendedSearch: true
  });

  statusText.innerText = `${sourceMessage} Total: ${rawData.length} whiskies.`;

  if (searchInput.value.trim()) {
    handleSearch(searchInput.value);
  } else {
    currentBaseData = rawData;
    renderTable(getSortedData(currentBaseData));
  }
}

function parseAbvNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  const normalizedStr = String(val).replace(/%/g, '').replace(',', '.').trim();
  const num = parseFloat(normalizedStr);
  if (isNaN(num)) return null;
  return num <= 1 ? num * 100 : num;
}

function parseYearNumber(val) {
  if (val === undefined || val === null || val === '') return null;
  const match = String(val).match(/\d{4}/);
  if (match) return parseInt(match[0], 10);
  const num = parseInt(String(val), 10);
  return isNaN(num) ? null : num;
}

function parseScoreNumber(item) {
  const scoreVal = item.Score !== undefined && item.Score !== null && item.Score !== ''
  ? item.Score
  : (item.AvgScore !== undefined && item.AvgScore !== null && item.AvgScore !== '' ? item.AvgScore : null);
  if (scoreVal === null) return null;
  const num = parseFloat(String(scoreVal).replace(',', '.').trim());
  return isNaN(num) ? null : num;
}

function parseWbNumber(val) {
  const codes = parseWbCodes(val);
  if (codes.length === 0) return null;
  const num = parseInt(codes[0].replace(/\D/g, ''), 10);
  return isNaN(num) ? null : num;
}

function sortItems(items, column, direction) {
  const sorted = [...items];
  sorted.sort((a, b) => {
    let diff = 0;
    if (column === 'Name') {
      const nameA = String(a.Name || '').trim();
      const nameB = String(b.Name || '').trim();
      diff = direction === 'asc'
      ? nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true })
      : nameB.localeCompare(nameA, undefined, { sensitivity: 'base', numeric: true });
    } else if (column === 'ABV') {
      const numA = parseAbvNumber(a.ABV);
      const numB = parseAbvNumber(b.ABV);
      if (numA === null && numB === null) diff = 0;
      else if (numA === null) return 1;
      else if (numB === null) return -1;
      else diff = direction === 'asc' ? numA - numB : numB - numA;
    } else if (column === 'Year') {
      const yrA = parseYearNumber(a.Year);
      const yrB = parseYearNumber(b.Year);
      if (yrA === null && yrB === null) diff = 0;
      else if (yrA === null) return 1;
      else if (yrB === null) return -1;
      else diff = direction === 'asc' ? yrA - yrB : yrB - yrA;
    } else if (column === 'Score') {
      const scA = parseScoreNumber(a);
      const scB = parseScoreNumber(b);
      if (scA === null && scB === null) diff = 0;
      else if (scA === null) return 1;
      else if (scB === null) return -1;
      else diff = direction === 'asc' ? scA - scB : scB - scA;
    } else if (column === 'WBcode') {
      const wbA = parseWbNumber(a.WBcode);
      const wbB = parseWbNumber(b.WBcode);
      if (wbA === null && wbB === null) diff = 0;
      else if (wbA === null) return 1;
      else if (wbB === null) return -1;
      else diff = direction === 'asc' ? wbA - wbB : wbB - wbA;
    }

    if (diff !== 0) return diff;
    const tieA = String(a.Name || '').trim();
    const tieB = String(b.Name || '').trim();
    return tieA.localeCompare(tieB, undefined, { sensitivity: 'base', numeric: true });
  });
  return sorted;
}

function getSortedData(items) {
  if (!currentSort.column || !currentSort.direction) {
    return items;
  }
  return sortItems(items, currentSort.column, currentSort.direction);
}

function updateSortIndicators() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const col = th.getAttribute('data-sort');
    const indicator = th.querySelector('[data-sort-indicator]');
    if (!indicator) return;

    if (currentSort.column === col && currentSort.direction) {
      if (currentSort.direction === 'asc') {
        indicator.textContent = '▲';
        th.setAttribute('aria-sort', 'ascending');
      } else {
        indicator.textContent = '▼';
        th.setAttribute('aria-sort', 'descending');
      }
      indicator.className = 'sort-indicator text-xs font-mono text-amber-400 font-bold ml-1 inline-block';
      th.classList.add('text-amber-300');
      th.classList.remove('text-zinc-400');
    } else {
      indicator.textContent = '';
      indicator.className = 'sort-indicator text-xs font-mono text-zinc-600 transition-colors ml-1 inline-block';
      th.setAttribute('aria-sort', 'none');
      th.classList.remove('text-amber-300');
      th.classList.add('text-zinc-400');
    }
  });

  const mobileSortSelect = document.getElementById('mobileSortSelect');
  if (mobileSortSelect) {
    mobileSortSelect.value = (currentSort.column && currentSort.direction)
    ? `${currentSort.column}-${currentSort.direction}`
    : '';
  }
}

function setSort(column) {
  if (currentSort.column === column) {
    const isDefaultDesc = (column === 'Score' || column === 'ABV' || column === 'Year');
    if (isDefaultDesc) {
      if (currentSort.direction === 'desc') {
        currentSort.direction = 'asc';
      } else if (currentSort.direction === 'asc') {
        currentSort = { column: null, direction: null };
      } else {
        currentSort.direction = 'desc';
      }
    } else {
      if (currentSort.direction === 'asc') {
        currentSort.direction = 'desc';
      } else if (currentSort.direction === 'desc') {
        currentSort = { column: null, direction: null };
      } else {
        currentSort.direction = 'asc';
      }
    }
  } else {
    const isDefaultDesc = (column === 'Score' || column === 'ABV' || column === 'Year');
    currentSort = { column, direction: isDefaultDesc ? 'desc' : 'asc' };
  }

  updateSortIndicators();
  if (currentBaseData.length > 0) {
    renderTable(getSortedData(currentBaseData));
  }
}

function getAverageScore(items) {
  const validScores = items
  .map(item => {
    const scoreVal = item.Score !== undefined && item.Score !== null ? item.Score : item.AvgScore;
    return parseFloat(String(scoreVal || '').replace(',', '.'));
  })
  .filter(score => !isNaN(score));

  if (validScores.length === 0) return null;

  const total = validScores.reduce((sum, score) => sum + score, 0);
  return (total / validScores.length).toFixed(1);
}

function formatAbv(val) {
  if (val === undefined || val === null || val === '') return '-';
  const normalizedStr = String(val).replace(/%/g, '').replace(',', '.');
  const num = parseFloat(normalizedStr);
  if (isNaN(num)) return escapeHtml(String(val));

  const percentage = num <= 1 ? num * 100 : num;
  return `${percentage.toFixed(1)}%`;
}

function renderTable(items) {
  currentFilteredData = items;
  resultsBody.textContent = '';

  if (items.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = `
    <td colspan="5" class="px-6 py-12 text-center text-zinc-500 font-medium">
    No whiskies found matching your query.
    </td>`;
    resultsBody.appendChild(emptyRow);
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item, idx) => {
    const formattedYear = item.Year
    ? escapeHtml(String(item.Year).replace(/\r\n|\r/g, '\n'))
    : '-';

    // Use formatWbLinks instead of formatWbList
    const wbLinks = formatWbLinks(item.WBcode);
    const displayScore = item.Score !== undefined && item.Score !== null ? item.Score : item.AvgScore;
    const displayName = escapeHtml(item.Name || '-');

    const tr = document.createElement('tr');
    tr.setAttribute('data-index', idx);
    tr.className = "whisky-row block md:table-row hover:bg-zinc-800/40 active:bg-zinc-800/60 transition-colors cursor-pointer border-b border-zinc-800/60 last:border-none p-4 md:p-0";

    tr.innerHTML = `
    <td class="block md:table-cell md:px-6 md:py-4">
    <div class="flex justify-between items-start md:block">
    <span class="text-xs font-semibold uppercase tracking-wider text-zinc-500 md:hidden">Name</span>
    <span class="font-semibold text-amber-200 text-base md:text-sm text-right md:text-left hover:text-amber-300 transition-colors">${displayName}</span>
    </div>
    </td>

    <td class="block md:table-cell md:px-6 md:py-4 text-zinc-300">
    <div class="flex justify-between items-center md:block">
    <span class="text-xs font-semibold uppercase tracking-wider text-zinc-500 md:hidden">ABV</span>
    <span class="font-medium">${formatAbv(item.ABV)}</span>
    </div>
    </td>

    <td class="block md:table-cell md:px-6 md:py-4 text-zinc-300">
    <div class="flex justify-between items-center md:block">
    <span class="text-xs font-semibold uppercase tracking-wider text-zinc-500 md:hidden">Year</span>
    <span class="whitespace-pre-line text-right md:text-left">${formattedYear}</span>
    </div>
    </td>

    <td class="block md:table-cell md:px-6 md:py-4">
    <div class="flex justify-between items-center md:block">
    <span class="text-xs font-semibold uppercase tracking-wider text-zinc-500 md:hidden">Score</span>
    <span class="font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-xs inline-block">${escapeHtml(String(displayScore || '-'))}</span>
    </div>
    </td>

    <td class="block md:table-cell md:px-6 md:py-4 text-zinc-400 font-mono text-xs">
    <div class="flex justify-between items-center md:block">
    <span class="text-xs font-semibold uppercase tracking-wider text-zinc-500 md:font-sans md:hidden">WB Code</span>
    <div class="flex flex-wrap gap-1.5 justify-end md:justify-start">${wbLinks}</div>
    </div>
    </td>
    `;

    fragment.appendChild(tr);
  });

  resultsBody.appendChild(fragment);
}

function escapeExtendedSearchToken(token) {
  // Strip double quotes and pipe operators that would alter search grouping/logic.
  const sanitized = token.replace(/["|]/g, '').trim();
  if (!sanitized) return '';

  // Support '=' prefix as an exact substring match (Fuse 'include' operator)
  // so queries like =Ardbeg match 'Ardbeg 10' exactly without fuzzy typos,
  // and =55.4 or =50 match exact ABV/Year values.
  if (sanitized.startsWith('=')) {
    const value = sanitized.slice(1).trim();
    return value ? `'"${value}"` : '';
  }

  // Wrap standard tokens in quotes so characters like ', !, ^, $ are treated as
  // literal fuzzy search characters instead of extended search operators.
  return `"${sanitized}"`;
}

function handleSearch(queryVal) {
  const query = queryVal.trim();

  if (query.length > 0) {
    clearBtn.classList.remove('hidden'); // cite: 1
  } else {
    clearBtn.classList.add('hidden'); // cite: 1
  }

  if (!query) {
    currentBaseData = rawData;
    statusText.innerText = `Showing all ${rawData.length} whiskies.`; // cite: 1
    renderTable(getSortedData(currentBaseData)); // cite: 1
    return;
  }

  if (!fuse) return; // cite: 1

  const cleanQuery = query.replace(/%/g, '').replace(',', '.');
  const tokens = cleanQuery.split(/\s+/).filter(t => t.length > 0);

  if (tokens.length === 0) {
    currentBaseData = rawData;
    renderTable(getSortedData(currentBaseData)); // cite: 1
    return;
  }

  const escapedTokens = tokens.map(escapeExtendedSearchToken).filter(t => t.length > 0);

  if (escapedTokens.length === 0) {
    currentBaseData = rawData;
    statusText.innerText = `Showing all ${rawData.length} whiskies.`;
    renderTable(getSortedData(currentBaseData));
    return;
  }

  const extendedQuery = {
    $and: escapedTokens.map(token => ({
      $or: [
        { Name: token },
        { YearStr: token },
        { WBcodeStr: token },
        { searchableABV: token },
        { ScoreStr: token }
      ]
    }))
  };

  const results = fuse.search(extendedQuery); // cite: 1
  const filteredData = results.map(res => res.item); // cite: 1
  currentBaseData = filteredData;

  const avgScore = getAverageScore(filteredData); // cite: 1
  const avgText = avgScore !== null
  ? ` with avg score of <span class="font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">${escapeHtml(avgScore)}</span>` // cite: 1
  : '';

  statusText.innerHTML = `Found <span class="text-zinc-100 font-semibold">${escapeHtml(filteredData.length)}</span> matching result(s)${avgText}.`; // cite: 1
  renderTable(getSortedData(currentBaseData)); // cite: 1
}

const debouncedSearch = debounce((e) => {
  handleSearch(e.target.value);
}, 150);

// Event Listeners
searchInput.addEventListener('search', (e) => {
  if (e.target.value === '') {
    clearBtn.classList.add('hidden');
    handleSearch('');
  }
});

resultsBody.addEventListener('click', (e) => {
  // If the user clicked directly on or inside an anchor link, let the browser follow the link
  if (e.target.closest('a')) {
    return;
  }

  const row = e.target.closest('.whisky-row');
  if (row) {
    const index = parseInt(row.getAttribute('data-index'), 10);
    if (!isNaN(index) && currentFilteredData[index]) {
      openDetailModal(currentFilteredData[index]);
    }
  }
});

searchInput.addEventListener('input', debouncedSearch);

clearBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearBtn.classList.add('hidden');
  searchInput.focus();
  handleSearch('');
});

syncBtn.addEventListener('click', fetchFreshData);
configBtn.addEventListener('click', openModal);
modalCloseBtn.addEventListener('click', closeModal);
modalCancelBtn.addEventListener('click', closeModal);
modalSaveBtn.addEventListener('click', saveCredentialsAndFetch);
detailCloseBtn.addEventListener('click', closeDetailModal);

configModal.addEventListener('click', (e) => {
  if (e.target === configModal) closeModal();
});

detailModal.addEventListener('click', (e) => {
  if (e.target === detailModal) closeDetailModal();
});

window.addEventListener('scroll', () => {
  if (window.scrollY > 300) {
    scrollToTopBtn.classList.remove('opacity-0', 'pointer-events-none');
    scrollToTopBtn.classList.add('opacity-100');
  } else {
    scrollToTopBtn.classList.remove('opacity-100');
    scrollToTopBtn.classList.add('opacity-0', 'pointer-events-none');
  }
});

scrollToTopBtn.addEventListener('click', () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
});

// Table Header sorting
document.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.getAttribute('data-sort');
    if (col) setSort(col);
  });
});

const mobileSortSelect = document.getElementById('mobileSortSelect');
if (mobileSortSelect) {
  mobileSortSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (!val) {
      currentSort = { column: null, direction: null };
    } else {
      const [col, dir] = val.split('-');
      currentSort = { column: col, direction: dir };
    }
    updateSortIndicators();
    if (currentBaseData.length > 0) {
      renderTable(getSortedData(currentBaseData));
    }
  });
}

// Sync quietly, but only when credentials exist (fetchFreshData opens the config modal otherwise)
// and only when the cached data is missing or older than AUTO_SYNC_INTERVAL_MS.
// (The "Sync DB" button calls fetchFreshData directly, so a manual sync always goes through.)
async function backgroundSync() {
  if (!navigator.onLine || !getEndpointUrl()) return;

  const rec = await loadCache();
  const age = rec && rec.syncedAt ? Date.now() - rec.syncedAt : Infinity;

  if (age >= AUTO_SYNC_INTERVAL_MS) {
    fetchFreshData();
  }
}

window.addEventListener('online', backgroundSync);

window.addEventListener('offline', () => {
  statusText.innerText = rawData.length > 0
  ? "Offline. Displaying cached data."
  : "Offline. No cached data available.";
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
    .then(reg => console.log('Service Worker registered!'))
    .catch(err => console.error('Service Worker registration failed:', err));
  });
}

// Ask the browser not to evict the cached data under storage pressure (best effort)
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

// Show cached data first, then refresh in the background
loadData().catch(console.error).then(backgroundSync);
