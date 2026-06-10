/* ───────────────────────────────────────────────────────────────────────────
   MLB WATCHABILITY INDEX — CORE UTILITIES
   ─────────────────────────────────────────────────────────────────────────── */

const APP_PREFS_KEY = 'mlbWatchPrefsV1';
const DATA_CACHE_PREFIX = 'mlbWatchCache:';
let usedStaleData = { value: false };

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(APP_PREFS_KEY) || '{}'); }
  catch (e) { return {}; }
}

function savePrefs(next = {}) {
  try {
    const merged = { ...loadPrefs(), ...next };
    localStorage.setItem(APP_PREFS_KEY, JSON.stringify(merged));
  } catch (e) {}
}

function readCache(key) {
  try { return JSON.parse(localStorage.getItem(DATA_CACHE_PREFIX + key) || 'null'); }
  catch (e) { return null; }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(DATA_CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (e) {}
}

async function fetchJson(url, { cacheKey = null, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    if (cacheKey) writeCache(cacheKey, data);
    return data;
  } catch (error) {
    const cached = cacheKey ? readCache(cacheKey) : null;
    if (cached) {
      usedStaleData.value = true;
      console.warn(`Using stale cache for ${cacheKey}:`, error.message);
      return cached.data;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function showNotification(message, type = 'info') {
  const container = document.getElementById('notification-container');
  if (!container) return;
  const notif = document.createElement('div');
  notif.className = `notification ${type}`;

  const text = document.createElement('span');
  text.textContent = message;
  notif.appendChild(text);

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.className = 'notif-close';
  closeBtn.setAttribute('aria-label', 'Close notification');
  closeBtn.onclick = () => {
    notif.style.opacity = '0';
    setTimeout(() => notif.remove(), 500);
  };
  notif.appendChild(closeBtn);

  container.appendChild(notif);
  setTimeout(() => {
    if (notif.parentNode) {
      notif.style.opacity = '0';
      setTimeout(() => notif.remove(), 500);
    }
  }, 10000);
}

function todayET() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const y = et.getFullYear();
  const m = String(et.getMonth() + 1).padStart(2, '0');
  const d = String(et.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
