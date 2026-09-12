const STORAGE_KEY_DB_URL = 'whisky_tracker_db_url';
const STORAGE_KEY_ACCESS_CODE = 'whisky_tracker_access_code';
const STORAGE_KEY_CACHE = 'whisky_tracker_cache_data';
const STORAGE_KEY_LAST_SYNC = 'whisky_tracker_last_sync';

let rawData = [];
let currentFilteredData = [];
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
    const cleanCode = escapeHtml(code.replace(/\D/g, '') || code);
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

  try {
    const response = await fetch(endpoint);

    if (response.status === 401 || response.status === 403) {
      throw new Error("Unauthorized access. Please check your Access Code.");
    }
    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const data = await response.json();
    const rawList = Array.isArray(data) ? data : Object.values(data || {});
    rawData = rawList.filter(item => item && item.Name);

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    const nowFormatted = `${hours}:${minutes}, ${day}.${month}.${year}`;

    localStorage.setItem(STORAGE_KEY_CACHE, JSON.stringify(rawData));
    localStorage.setItem(STORAGE_KEY_LAST_SYNC, nowFormatted);

    initSearchAndUI(`Synced now (${nowFormatted}).`);
  } catch (err) {
    console.error(err);
    if (err instanceof TypeError || !navigator.onLine) {
      statusText.innerText = "Offline/Network error. Showing cached data.";
    } else {
      statusText.innerText = `Sync failed: ${err.message}`;
      if (rawData.length === 0) {
        resultsBody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-red-400 font-medium">${escapeHtml(err.message)}</td></tr>`;
      }
    }
  }
}

function loadData() {
  const cached = localStorage.getItem(STORAGE_KEY_CACHE);
  const lastSync = localStorage.getItem(STORAGE_KEY_LAST_SYNC);

  if (cached) {
    try {
      rawData = JSON.parse(cached);
      const syncInfo = lastSync ? `Cached data (${lastSync}).` : 'Loaded from cache.';
      initSearchAndUI(syncInfo);
      return;
    } catch (e) {
      console.error("Failed to parse local cache:", e);
    }
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
    renderTable(rawData);
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

    const formattedWb = formatWbList(item.WBcode);
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
    <span class="text-xs font-semibold uppercase tracking-wider text-zinc-500 font-sans md:hidden">WB Code</span>
    <span class="whitespace-pre-line text-right md:text-left">${formattedWb}</span>
    </div>
    </td>
    `;

    fragment.appendChild(tr);
  });

  resultsBody.appendChild(fragment);
}

function handleSearch(queryVal) {
  const query = queryVal.trim();

  if (query.length > 0) {
    clearBtn.classList.remove('hidden'); // cite: 1
  } else {
    clearBtn.classList.add('hidden'); // cite: 1
  }

  if (!query) {
    renderTable(rawData); // cite: 1
    statusText.innerText = `Showing all ${rawData.length} whiskies.`; // cite: 1
    return;
  }

  if (!fuse) return; // cite: 1

  const cleanQuery = query.replace(/%/g, '').replace(',', '.');
  const tokens = cleanQuery.split(/\s+/).filter(t => t.length > 0);

  if (tokens.length === 0) {
    renderTable(rawData); // cite: 1
    return;
  }

  const extendedQuery = {
    $and: tokens.map(token => ({
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

  const avgScore = getAverageScore(filteredData); // cite: 1
  const avgText = avgScore !== null
  ? ` with avg score of <span class="font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">${escapeHtml(avgScore)}</span>` // cite: 1
  : '';

  statusText.innerHTML = `Found <span class="text-zinc-100 font-semibold">${escapeHtml(filteredData.length)}</span> matching result(s)${avgText}.`; // cite: 1
  renderTable(filteredData); // cite: 1
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
    .then(reg => console.log('Service Worker registered!'))
    .catch(err => console.error('Service Worker registration failed:', err));
  });
}

loadData();
