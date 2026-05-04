const LINE_RE = /^\((\d+(?:\.\d+)?)\)\s+(\S+)\s+([0-9A-Fa-f]+)(#{1,2})([0-9A-Fa-fRr]*)/;

export function parseCandumpText(text) {
  const frames = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const frame = parseCandumpLine(line);
    if (frame) frames.push(frame);
  }
  return frames;
}

export function parseCandumpLine(line) {
  const match = LINE_RE.exec(line.trim());
  if (!match) return null;
  const dataText = match[5];
  if (/^r$/i.test(dataText)) return null;
  const bytes = hexToBytes(dataText);
  return {
    timestamp: Number(match[1]),
    iface: match[2],
    canId: Number.parseInt(match[3], 16),
    extended: match[3].length > 3 || Number.parseInt(match[3], 16) > 0x7ff,
    fd: match[4] === '##',
    data: bytes,
    raw: line,
  };
}

export function hexToBytes(hex) {
  const clean = hex.length % 2 === 0 ? hex : hex.slice(1);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function readU16LE(data, offset) {
  if (offset + 1 >= data.length) return NaN;
  return data[offset] | (data[offset + 1] << 8);
}

export function readI32LE(data, offset) {
  if (offset + 3 >= data.length) return NaN;
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) | 0;
}

export function readU32LE(data, offset) {
  return readI32LE(data, offset) >>> 0;
}
