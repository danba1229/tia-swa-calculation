// Per-input, memory-only cache: never persist searched addresses to browser storage.
export function createAddressSuggestionCache({ maxEntries = 50, ttlMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const entries = new Map();
  return {
    get(query) {
      const entry = entries.get(query);
      return entry && entry.expiresAt > now() ? entry.items : undefined;
    },
    set(query, items) {
      const timestamp = now();
      for (const [key, entry] of entries) {
        if (entry.expiresAt <= timestamp) entries.delete(key);
      }
      entries.delete(query);
      entries.set(query, { items, expiresAt: timestamp + ttlMs });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
  };
}
