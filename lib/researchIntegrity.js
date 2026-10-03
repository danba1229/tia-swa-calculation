export function nullableArea(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function residualArea(total, values) {
  const parsedTotal = nullableArea(total);
  const parsed = values.map(nullableArea);
  if (parsedTotal === null || parsed.some((value) => value === null)) return null;
  const remainder = parsedTotal - parsed.reduce((sum, value) => sum + value, 0);
  return remainder >= 0 ? remainder : null;
}

export function areaStats(entries, sourceTotal) {
  const normalized = entries.map((entry) => ({ ...entry, value: nullableArea(entry.value) }));
  const complete = normalized.length > 0 && normalized.every((entry) => entry.value !== null);
  const knownTotal = normalized.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  const total = nullableArea(sourceTotal) ?? (complete ? knownTotal : null);
  const consistent = total === null || knownTotal <= total;
  return { entries: normalized, total, knownTotal, complete, consistent };
}

// Starting a new request invalidates older callbacks, even if transport cancellation is late.
export function createRequestGate() {
  const requests = new Map();
  return {
    start(channel) {
      requests.get(channel)?.abort();
      const controller = new AbortController();
      requests.set(channel, controller);
      return { signal: controller.signal, current: () => requests.get(channel) === controller && !controller.signal.aborted };
    },
    cancel(channel) {
      if (channel) requests.get(channel)?.abort();
      else for (const controller of requests.values()) controller.abort();
    },
  };
}
