import { readI32LE, readU16LE, readU32LE } from './candump.js';
import { DBC_SIGNALS, decodeDbcFrame } from './dbc.js';

const CORE_SIGNALS = [
  { id: 'can.rate', label: 'CAN message rate', group: 'bus', unit: 'msg/s', color: '#f8ff7a' },
  { id: 'pedal.throttle', label: 'Throttle raw', group: 'pedal', unit: 'raw', color: '#75f0ff' },
  { id: 'pedal.brake0', label: 'Brake 0 raw', group: 'pedal', unit: 'raw', color: '#ff9a76' },
  { id: 'pedal.brake1', label: 'Brake 1 raw', group: 'pedal', unit: 'raw', color: '#ffbd6b' },
  { id: 'wheel.0.raw', label: 'Wheel 0 speed', group: 'wheels', unit: 'raw', color: '#a2ff72' },
  { id: 'wheel.1.raw', label: 'Wheel 1 speed', group: 'wheels', unit: 'raw', color: '#75f0ff' },
  { id: 'wheel.2.raw', label: 'Wheel 2 speed', group: 'wheels', unit: 'raw', color: '#f8ff7a' },
  { id: 'wheel.3.raw', label: 'Wheel 3 speed', group: 'wheels', unit: 'raw', color: '#ffbd6b' },
  { id: 'ams.vbus.raw', label: 'AMS vbus raw', group: 'battery', unit: 'raw', color: '#d4a2ff' },
  { id: 'ams.ts.raw', label: 'AMS tractive raw', group: 'battery', unit: 'raw', color: '#c17cff' },
  { id: 'segment.voltage.mv', label: 'Segment voltage', group: 'battery', unit: 'mV', color: '#9cffc7' },
  { id: 'segment.temp.raw', label: 'Segment die temp', group: 'battery', unit: 'raw', color: '#ff7faf' },
  { id: 'inverter.dc.raw', label: 'Inverter DC raw', group: 'inverter', unit: 'raw', color: '#7aa0ff' },
  { id: 'raw.can_id', label: 'CAN ID', group: 'debug', unit: 'id', color: '#d7dce8' },
];

export const SIGNALS = [...CORE_SIGNALS, ...DBC_SIGNALS];
export const SIGNAL_BY_ID = Object.fromEntries(SIGNALS.map((signal) => [signal.id, signal]));
export const SIGNAL_ORDER = new Map(SIGNALS.map((signal, index) => [signal.id, index]));

export function decodeFrame(frame, state) {
  const samples = [];
  const t = frame.timestamp;
  const id = frame.canId;
  const data = frame.data;

  state.countWindow.push(t);
  while (state.countWindow.length && t - state.countWindow[0] > 1) state.countWindow.shift();
  samples.push(['can.rate', t, state.countWindow.length]);
  samples.push(['raw.can_id', t, id]);

  if (id === 0x300) {
    samples.push(['pedal.throttle', t, readU32LE(data, 0)]);
  } else if (id === 0x301) {
    samples.push(['pedal.brake0', t, readI32LE(data, 0)]);
    samples.push(['pedal.brake1', t, readI32LE(data, 4)]);
  } else if (id === 0x70d || id === 0x70c) {
    const wheelId = data[0];
    if (wheelId >= 0 && wheelId <= 3) {
      samples.push([`wheel.${wheelId}.raw`, t, readI32LE(data, 1)]);
    }
  } else if (id === 0x405) {
    samples.push(['ams.vbus.raw', t, readI32LE(data, 0)]);
    if (data.length >= 8) samples.push(['ams.ts.raw', t, readI32LE(data, 4)]);
  } else if (id === 0x403) {
    samples.push(['segment.voltage.mv', t, readU16LE(data, 0)]);
    samples.push(['segment.temp.raw', t, data[3] ?? NaN]);
  } else if (id === 0x19107171 || id === 0x19117171 || id === 0x19127171) {
    samples.push(['inverter.dc.raw', t, readI32LE(data, 0)]);
  }

  samples.push(...decodeDbcFrame(frame));

  return samples.filter(([, , value]) => Number.isFinite(value));
}

export function createDecodeState() {
  return { countWindow: [] };
}
