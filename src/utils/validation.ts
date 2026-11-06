export const LIMITS = {
  title: 300,
  description: 5000,
  label: 32,
  labels: 10,
  subtasks: 50,
  url: 2048,
  history: 20,
  sessions: 500,
} as const;

/** Trims, collapses whitespace and strips control characters. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function cleanTitle(value: unknown): string {
  return cleanText(value, LIMITS.title).replace(/\s+/g, ' ');
}

/**
 * Accepts only http(s) URLs (plus bare domains, which get https://).
 * Anything else — javascript:, data:, file: — is rejected so it can never
 * end up in an href.
 */
export function normalizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let raw = value.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    if (!/^[^\s/]+\.[^\s/]+/.test(raw)) return null;
    raw = `https://${raw}`;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const href = url.href;
    return href.length <= LIMITS.url ? href : null;
  } catch {
    return null;
  }
}

export function cleanLabel(value: unknown): string {
  return cleanText(value, LIMITS.label)
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

export function cleanLabels(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    const label = cleanLabel(v);
    if (label && !out.includes(label)) out.push(label);
    if (out.length >= LIMITS.labels) break;
  }
  return out;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
