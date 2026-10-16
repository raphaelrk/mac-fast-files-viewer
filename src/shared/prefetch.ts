export const PREVIEW_RADIUS = 20;
export const MAX_PREVIEW_WINDOW = PREVIEW_RADIUS * 2 + 1;
export const BROWSER_CACHE_BYTES = 256 * 1024 ** 2;

/** Nearest files first, slightly favoring forward browsing. */
export function neighbors<T>(items: T[], center: number, radius = PREVIEW_RADIUS): T[] {
  if (center < 0 || center >= items.length) return [];
  const result = [items[center]];
  for (let distance = 1; distance <= radius; distance++) {
    if (center + distance < items.length) result.push(items[center + distance]);
    if (center - distance >= 0) result.push(items[center - distance]);
  }
  return result;
}
