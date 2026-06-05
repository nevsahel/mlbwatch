import { fetchJson, escapeHTML, todayET } from './core.js';
import { fetchJson, escapeHTML } from "./core.js";
/* ───────────────────────────────────────────────────────────────────────────
   PERFORMANCE & REQUEST MANAGEMENT UTILITIES
   ─────────────────────────────────────────────────────────────────────────── */

// Request deduplication pool - prevents duplicate simultaneous API calls
export class RequestPool {
  constructor() {
    this.pending = new Map();
    this.metrics = {
      totalRequests: 0,
      deduplicatedRequests: 0,
      totalTime: 0
    };
  }

  async fetchDedup(url, options = {}) {
    const { cacheKey = url, timeout = 10000 } = options;
    
    // Return existing pending request if available
    if (this.pending.has(cacheKey)) {
      this.metrics.deduplicatedRequests++;
      console.log(`[RequestPool] Cache hit: ${cacheKey}`);
      return this.pending.get(cacheKey);
    }

    this.metrics.totalRequests++;
    const startTime = performance.now();
    
    const promise = fetchJson(url, { cacheKey, timeoutMs: timeout })
      .finally(() => {
        this.pending.delete(cacheKey);
        const elapsed = performance.now() - startTime;
        this.metrics.totalTime += elapsed;
      });

    this.pending.set(cacheKey, promise);
    return promise;
  }

  getMetrics() {
    const avgTime = this.metrics.totalRequests > 0 
      ? (this.metrics.totalTime / this.metrics.totalRequests).toFixed(0)
      : 0;
    return {
      ...this.metrics,
      avgTimeMs: avgTime,
      savedRequests: this.metrics.deduplicatedRequests
    };
  }

  resetMetrics() {
    this.metrics = { totalRequests: 0, deduplicatedRequests: 0, totalTime: 0 };
  }

  logMetrics() {
    const metrics = this.getMetrics();
    console.group('📊 Request Pool Metrics');
    console.log(`Total requests: ${metrics.totalRequests}`);
    console.log(`Deduplicated: ${metrics.deduplicatedRequests}`);
    console.log(`Average time: ${metrics.avgTimeMs}ms`);
    console.groupEnd();
  }
}

export const requestPool = new RequestPool();

// Performance timing utility
export class PerfTimer {
  constructor() {
    this.marks = {};
    this.measures = {};
  }

  mark(name) {
    this.marks[name] = performance.now();
  }

  measure(name, startMark) {
    if (!this.marks[startMark]) return null;
    const elapsed = performance.now() - this.marks[startMark];
    this.measures[name] = elapsed;
    console.log(`[Perf] ${name}: ${elapsed.toFixed(0)}ms`);
    return elapsed;
  }

  getMeasure(name) {
    return this.measures[name] || null;
  }

  logAll() {
    console.group('⏱ Performance Metrics');
    Object.entries(this.measures).forEach(([name, time]) => {
      console.log(`${name}: ${time.toFixed(0)}ms`);
    });
    console.groupEnd();
  }

  getAll() {
    return { ...this.measures };
  }

  reset() {
    this.marks = {};
    this.measures = {};
  }
}

export const perfTimer = new PerfTimer();

// Error boundary wrapper for safe rendering
export function renderWithErrorBoundary(fn, containerId, fallbackMsg = 'Failed to load content') {
  try {
    fn();
  } catch (e) {
    console.error(`[Error in ${containerId}]`, e);
    const el = document.getElementById(containerId);
    if (el) {
      el.innerHTML = `
        <div style="padding:20px;text-align:center;color:#ef4444;border-radius:8px;background:#1a0a0a;border:1px solid #ef4444;">
          <strong>⚠ ${fallbackMsg}</strong>
          <p style="font-size:0.85rem;color:#888;margin-top:8px;margin-bottom:0;">
            ${escapeHTML(e.message)}
          </p>
          <button onclick="location.reload()" style="margin-top:12px;padding:6px 12px;background:#ef4444;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:600;font-size:0.85rem;">
            Reload Page
          </button>
        </div>
      `;
    }
    showNotification(`Error: ${e.message}`, 'error');
  }
}

// Batch API calls with intelligent queuing
export class BatchFetcher {
  constructor(maxParallel = 5) {
    this.maxParallel = maxParallel;
    this.queue = [];
    this.active = 0;
  }

  async add(fn, priority = 0) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, priority, resolve, reject });
      this.queue.sort((a, b) => b.priority - a.priority);
      this.process();
    });
  }

  async process() {
    if (this.active >= this.maxParallel || this.queue.length === 0) return;

    this.active++;
    const { fn, resolve, reject } = this.queue.shift();

    try {
      const result = await fn();
      resolve(result);
    } catch (e) {
      console.error('[BatchFetcher]', e);
      reject(e);
    } finally {
      this.active--;
      this.process();
    }
  }

  getQueueSize() {
    return this.queue.length;
  }

  getStats() {
    return {
      active: this.active,
      queued: this.queue.length,
      maxParallel: this.maxParallel
    };
  }
}

export const batchFetcher = new BatchFetcher(5);

// Persistent cache layer (localStorage + memory with TTL support)
export class PersistentCache {
  constructor(prefix = 'mlbWatch:') {
    this.prefix = prefix;
    this.memory = new Map();
    this.ttl = {};
  }

  set(key, value, ttlMs = null) {
    const fullKey = this.prefix + key;
    const entry = { value, savedAt: Date.now() };
    
    try {
      localStorage.setItem(fullKey, JSON.stringify(entry));
    } catch (e) {
      console.warn('[PersistentCache] localStorage full, using memory only');
    }
    
    this.memory.set(fullKey, entry);
    
    if (ttlMs) {
      this.ttl[fullKey] = Date.now() + ttlMs;
    }
  }

  get(key) {
    const fullKey = this.prefix + key;
    
    // Check if expired
    if (this.ttl[fullKey] && Date.now() > this.ttl[fullKey]) {
      this.delete(key);
      return null;
    }

    // Try memory first
    if (this.memory.has(fullKey)) {
      return this.memory.get(fullKey).value;
    }

    // Try localStorage
    try {
      const stored = localStorage.getItem(fullKey);
      if (stored) {
        const entry = JSON.parse(stored);
        this.memory.set(fullKey, entry);
        return entry.value;
      }
    } catch (e) {
      console.warn('[PersistentCache] localStorage read failed');
    }

    return null;
  }

  delete(key) {
    const fullKey = this.prefix + key;
    this.memory.delete(fullKey);
    delete this.ttl[fullKey];
    try {
      localStorage.removeItem(fullKey);
    } catch (e) {}
  }

  clear() {
    this.memory.clear();
    this.ttl = {};
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(this.prefix))
        .forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }

  getSize() {
    return {
      memory: this.memory.size,
      storage: Object.keys(localStorage).filter(k => k.startsWith(this.prefix)).length
    };
  }

  logStats() {
    const stats = this.getSize();
    console.log(`[PersistentCache] Memory: ${stats.memory}, Storage: ${stats.storage}`);
  }
}

export const persistentCache = new PersistentCache('mlbWatch:');

// Keyboard shortcut registry
export class KeyboardShortcuts {
  constructor() {
    this.shortcuts = new Map();
    this.registerDefaults();
    window.addEventListener('keydown', (e) => this.handle(e));
  }

  register(key, ctrl = false, shift = false, callback) {
    const combo = `${ctrl ? 'ctrl-' : ''}${shift ? 'shift-' : ''}${key}`;
    this.shortcuts.set(combo, callback);
  }

  handle(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const combo = `${e.ctrlKey ? 'ctrl-' : ''}${e.shiftKey ? 'shift-' : ''}${e.key.toLowerCase()}`;
    const handler = this.shortcuts.get(combo);
    if (handler) {
      e.preventDefault();
      handler();
    }
  }

  registerDefaults() {
    this.register('s', true, false, () => {
      const startBtn = document.getElementById('start-btn');
      if (startBtn && !startBtn.disabled) {
        startBtn.click();
      } else {
        document.getElementById('stop-btn').click();
      }
    });
    this.register('r', true, false, () => {
      location.reload();
    });
  }
}

export const keyboardShortcuts = new KeyboardShortcuts();
