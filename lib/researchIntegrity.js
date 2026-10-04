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
  const epsilon = Math.max(1, parsedTotal) * Number.EPSILON * (parsed.length + 1);
  if (remainder < -epsilon) return null;
  const precision = Math.max(...[parsedTotal, ...parsed].map((value) => {
    const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
    return Math.max(0, (mantissa.split(".")[1]?.length || 0) - Number(exponent));
  }));
  // Remove binary arithmetic noise without rounding the source areas to integers.
  return Number(Math.max(0, remainder).toFixed(Math.min(precision, 15)));
}

export function areaStats(entries, sourceTotal) {
  const normalized = entries.map((entry) => ({ ...entry, value: nullableArea(entry.value) }));
  const complete = normalized.length > 0 && normalized.every((entry) => entry.value !== null);
  const knownTotal = normalized.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  const total = nullableArea(sourceTotal) ?? (complete ? knownTotal : null);
  const epsilon = Math.max(1, total ?? 0, knownTotal) * Number.EPSILON * (normalized.length + 1);
  const consistent = total === null || knownTotal <= total + epsilon;
  return { entries: normalized, total, knownTotal, complete, consistent };
}

export function validSurveyCenter(latitude, longitude) {
  if ([latitude, longitude].some((value) => value === null || value === undefined || String(value).trim() === "")) return false;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 33 && lat <= 39.5 && lng >= 124 && lng <= 132;
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
