import { DBC_TEXTS } from './dbc-text.js';

const PALETTE = [
  '#75f0ff', '#f8ff7a', '#ffbd6b', '#ff9a76', '#a2ff72', '#d4a2ff',
  '#9cffc7', '#ff7faf', '#7aa0ff', '#d7dce8', '#74d7a8', '#cddc69',
];

const parsed = parseDbcTexts(DBC_TEXTS);

export const DBC_SIGNALS = parsed.signals;
export const DBC_MESSAGES_BY_ID = parsed.messagesById;

export function decodeDbcFrame(frame) {
  const messages = DBC_MESSAGES_BY_ID.get(frame.canId);
  if (!messages) return [];
  const out = [];
  for (const message of messages) {
    for (const signal of message.signals) {
      const value = decodeSignal(frame.data, signal);
      if (Number.isFinite(value)) out.push([signal.id, frame.timestamp, value]);
    }
  }
  return out;
}

export function parseDbcTexts(texts) {
  const messages = [];
  const messagesById = new Map();

  for (const source of texts) {
    let current = null;
    for (const line of source.text.split(/\r?\n/)) {
      const bo = line.match(/^BO_\s+(\d+)\s+([A-Za-z0-9_]+):\s+(\d+)\s+([A-Za-z0-9_]+)/);
      if (bo) {
        current = {
          source: source.name.replace(/\.dbc$/i, ''),
          canId: Number(bo[1]),
          name: bo[2],
          dlc: Number(bo[3]),
          transmitter: bo[4],
          signals: [],
        };
        messages.push(current);
        if (!messagesById.has(current.canId)) messagesById.set(current.canId, []);
        messagesById.get(current.canId).push(current);
        continue;
      }

      if (!current) continue;
      const sg = line.match(/^\s*SG_\s+([A-Za-z0-9_]+)\s*:\s*(\d+)\|(\d+)@([01])([+-])\s+\(([-+0-9.eE]+),([-+0-9.eE]+)\)\s+\[([-+0-9.eE]+)\|([-+0-9.eE]+)\]\s+"([^"]*)"/);
      if (!sg) continue;
      const signal = {
        message: current,
        name: sg[1],
        startBit: Number(sg[2]),
        length: Number(sg[3]),
        endian: sg[4] === '1' ? 'little' : 'big',
        signed: sg[5] === '-',
        factor: Number(sg[6]),
        offset: Number(sg[7]),
        min: Number(sg[8]),
        max: Number(sg[9]),
        unit: sg[10],
      };
      signal.id = `dbc.${slug(current.source)}.${slug(current.name)}.${slug(signal.name)}`;
      signal.label = `${current.name} ${signal.name}`;
      signal.group = `dbc ${current.name}`;
      current.signals.push(signal);
    }
  }

  let colorIndex = 0;
  const signals = [];
  for (const message of messages) {
    for (const signal of message.signals) {
      signals.push({
        id: signal.id,
        label: signal.label,
        group: signal.group,
        unit: signal.unit || 'raw',
        color: PALETTE[colorIndex++ % PALETTE.length],
      });
    }
  }

  return { messages, messagesById, signals };
}

function decodeSignal(data, signal) {
  if (!signal.length || signal.length > 52) return NaN;
  const raw = signal.endian === 'little'
    ? extractLittleEndian(data, signal.startBit, signal.length)
    : extractBigEndian(data, signal.startBit, signal.length);
  if (raw == null) return NaN;
  let value = raw;
  if (signal.signed) {
    const signBit = 1n << BigInt(signal.length - 1);
    if ((value & signBit) !== 0n) value -= 1n << BigInt(signal.length);
  }
  return Number(value) * signal.factor + signal.offset;
}

function extractLittleEndian(data, startBit, length) {
  let raw = 0n;
  for (let i = 0; i < length; i++) {
    const bitIndex = startBit + i;
    const byte = data[bitIndex >> 3];
    if (byte == null) return null;
    if ((byte & (1 << (bitIndex & 7))) !== 0) raw |= 1n << BigInt(i);
  }
  return raw;
}

function extractBigEndian(data, startBit, length) {
  let raw = 0n;
  for (let i = 0; i < length; i++) {
    const bitIndex = startBit - i;
    const byte = data[bitIndex >> 3];
    if (byte == null || bitIndex < 0) return null;
    if ((byte & (1 << (7 - (bitIndex & 7)))) !== 0) raw |= 1n << BigInt(length - 1 - i);
  }
  return raw;
}

function slug(value) {
  return String(value).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}
