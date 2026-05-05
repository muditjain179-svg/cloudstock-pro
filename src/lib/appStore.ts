import { saveToIndexedDB } from './indexedDB';

export interface CacheEntry {
  data: any[];
  timestamp: number;
}

/**
 * Global RAM cache for CloudStock Inventory Pro.
 * Persists between module switches as it is outside React components.
 */
const RAM_CACHE: Record<string, CacheEntry> = {};
const RAM_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Checks if the cached data for a given key is fresh (less than 5 minutes old).
 */
export function isCacheFresh(key: string): boolean {
  const entry = RAM_CACHE[key];
  if (!entry) return false;
  return Date.now() - entry.timestamp < RAM_CACHE_TTL;
}

/**
 * Returns cached data for a collection.
 */
export function getCache(key: string): any[] | null {
  const entry = RAM_CACHE[key];
  if (!entry) return null;
  return entry.data;
}

/**
 * Saves data to RAM cache and triggers IndexedDB persistence.
 */
export function setCache(key: string, data: any[]) {
  RAM_CACHE[key] = {
    data,
    timestamp: Date.now(),
  };
  saveToIndexedDB(key, data);
}

/**
 * Wipes all cached data from RAM.
 */
export function clearCache() {
  Object.keys(RAM_CACHE).forEach(key => {
    delete RAM_CACHE[key];
  });
}
