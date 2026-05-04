import { formatBytes } from './dom.js';

export async function loadCatalog(url) {
  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`Catalog failed: ${response.status}`);
  const html = await response.text();
  return parseCatalog(html, url);
}

export function parseCatalog(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = [...doc.querySelectorAll('tr.file')];
  const logs = [];
  for (const row of rows) {
    const link = row.querySelector('a[href$=".log"]');
    if (!link) continue;
    const sizeCell = row.querySelector('td[data-order]');
    const time = row.querySelector('time');
    const name = link.textContent.trim();
    logs.push({
      name,
      url: new URL(link.getAttribute('href'), baseUrl).toString(),
      size: Number(sizeCell?.getAttribute('data-order') || 0),
      modified: time?.getAttribute('datetime') || '',
    });
  }
  logs.sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
  return logs;
}

export function logSubtitle(log) {
  const parts = [];
  if (log.size) parts.push(formatBytes(log.size));
  if (log.modified) parts.push(log.modified.replace(' +0000 UTC', 'Z'));
  return parts.join(' · ');
}
