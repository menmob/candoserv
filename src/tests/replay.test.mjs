import assert from 'node:assert/strict';
import { ReplayEngine, findFrameIndexAtOrAfter } from '../src/replay.js';
import { SeriesStore } from '../src/series-store.js';

const frames = [
  { timestamp: 10.0 },
  { timestamp: 10.1 },
  { timestamp: 10.5 },
  { timestamp: 12.0 },
  { timestamp: 20.0 },
];

assert.equal(findFrameIndexAtOrAfter(frames, 9), 0);
assert.equal(findFrameIndexAtOrAfter(frames, 10.0), 0);
assert.equal(findFrameIndexAtOrAfter(frames, 10.2), 2);
assert.equal(findFrameIndexAtOrAfter(frames, 12.0), 3);
assert.equal(findFrameIndexAtOrAfter(frames, 99), 4);

const store = new SeriesStore();
const replay = new ReplayEngine(store);
replay.frames = [
  { timestamp: 1, canId: 0x300, data: new Uint8Array([1, 0, 0, 0]) },
  { timestamp: 2, canId: 0x300, data: new Uint8Array([2, 0, 0, 0]) },
  { timestamp: 3, canId: 0x300, data: new Uint8Array([3, 0, 0, 0]) },
];
replay.consumeFrame();
assert.equal(store.length('pedal.throttle'), 1);
replay.seek(0.5);
assert.equal(store.length('pedal.throttle'), 0);
assert.equal(replay.frameIndex, 1);

replay.timelineStart = 1;
replay.timelineEnd = 101;
replay.seek(0.5);
assert.equal(replay.playheadTime, 51);
assert.equal(replay.progress().start, 1);
assert.equal(replay.progress().end, 101);

const remoteStore = new SeriesStore();
const remoteReplay = new ReplayEngine(remoteStore);
const fakeRange = {
  size: 1_000_000,
  bytesFetched: 0,
  lastStatus: null,
  async head() {
    return { size: this.size, acceptRanges: true };
  },
  async fetchTextRange(start) {
    this.lastStatus = 206;
    const text = start === 0
      ? '(10.000000) can0 300#0100000000\n(10.100000) can0 300#0200000000\n'
      : '(109.800000) can0 300#0300000000\n(110.000000) can0 300#0400000000\n';
    this.bytesFetched += text.length;
    return { text, carry: '' };
  },
};
await remoteReplay.loadRemote({ name: 'remote.log' }, fakeRange);
assert.equal(remoteReplay.progress().start, 10);
assert.equal(remoteReplay.progress().end, 110);
assert.equal(remoteReplay.frameIndex, 0);

console.log('replay seek ok');
