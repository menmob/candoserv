export function $(selector, root = document) {
  const node = root.querySelector(selector);
  if (!node) throw new Error(`Missing DOM node: ${selector}`);
  return node;
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '--';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

export function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return '--';
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const whole = Math.floor(abs);
  const ms = Math.floor((abs - whole) * 1000);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) return `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  return `${sign}${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function setNotice(node, message) {
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}
