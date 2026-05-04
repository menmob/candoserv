import assert from 'node:assert/strict';
import { parseCandumpLine, parseCandumpText } from '../src/candump.js';
import { createDecodeState, decodeFrame } from '../src/signals.js';
import { SAMPLE_LOG } from '../src/config.js';

const frame = parseCandumpLine('(1777484216.293542) can0 300#4A00000001');
assert.equal(frame.timestamp, 1777484216.293542);
assert.equal(frame.iface, 'can0');
assert.equal(frame.canId, 0x300);
assert.equal(frame.data.length, 5);

const frames = parseCandumpText(SAMPLE_LOG);
assert.ok(frames.length > 10);

const decoded = decodeFrame(frame, createDecodeState());
assert.ok(decoded.some(([id, , value]) => id === 'pedal.throttle' && value === 74));

const wheel = parseCandumpLine('(1777484216.295077) can0 70D#019ECFFFFF');
const wheelDecoded = decodeFrame(wheel, createDecodeState());
assert.ok(wheelDecoded.some(([id]) => id === 'wheel.1.raw'));

const brake = parseCandumpLine('(1777484216.293541) can0 301#1100000004000000');
const brakeDecoded = decodeFrame(brake, createDecodeState());
assert.ok(brakeDecoded.some(([id, , value]) => id === 'pedal.brake0' && value === 17));
assert.ok(brakeDecoded.some(([id, , value]) => id === 'pedal.brake1' && value === 4));

console.log(`parser ok: ${frames.length} sample frames`);
