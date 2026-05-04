import { CHUNK_SIZE, PRELOAD_BYTES } from './config.js?v=20260504-history-dbc4';
import { parseCandumpText } from './candump.js';
import { createDecodeState, decodeFrame } from './signals.js';

export class ReplayEngine extends EventTarget {
  constructor(store) {
    super();
    this.store = store;
    this.source = null;
    this.frames = [];
    this.frameIndex = 0;
    this.playing = false;
    this.speed = 1;
    this.baseWall = 0;
    this.baseLog = 0;
    this.playheadTime = null;
    this.timelineStart = null;
    this.timelineEnd = null;
    this.decodeState = createDecodeState();
    this.abortController = null;
    this.bytesFetched = 0;
    this.remote = null;
    this.loading = false;
    this.historySeconds = 20;
  }

  loadSample(name, text) {
    this.stop();
    this.loading = true;
    this.dispatch('loading', { name });
    this.source = { kind: 'sample', name, text };
    this.remote = null;
    this.frames = parseCandumpText(text);
    this.frameIndex = 0;
    this.playheadTime = this.frames[0]?.timestamp ?? null;
    this.timelineStart = this.frames[0]?.timestamp ?? null;
    this.timelineEnd = this.frames[this.frames.length - 1]?.timestamp ?? null;
    this.bytesFetched = new TextEncoder().encode(text).byteLength;
    this.decodeState = createDecodeState();
    this.store.reset();
    this.loading = false;
    this.dispatch('loaded', this.metadata());
  }

  async loadRemote(log, rangeFile) {
    this.stop();
    this.loading = true;
    this.dispatch('loading', { name: log.name });
    this.source = { kind: 'remote', log, rangeFile };
    this.remote = {
      nextOffset: 0,
      carry: '',
      fetching: null,
      done: false,
    };
    this.frames = [];
    this.frameIndex = 0;
    this.playheadTime = null;
    this.timelineStart = null;
    this.timelineEnd = null;
    this.bytesFetched = 0;
    this.decodeState = createDecodeState();
    this.store.reset();
    this.abortController = new AbortController();
    try {
      await rangeFile.head();
      await this.fetchNextChunk();
      await this.estimateTimelineEnd();
      await this.preloadRemote();
      this.bytesFetched = rangeFile.bytesFetched;
      this.playheadTime = this.frames[0]?.timestamp ?? null;
      this.timelineStart = this.frames[0]?.timestamp ?? null;
      this.timelineEnd = this.timelineEnd ?? this.frames[this.frames.length - 1]?.timestamp ?? null;
      this.loading = false;
      this.dispatch('loaded', this.metadata());
    } catch (error) {
      this.loading = false;
      throw error;
    }
  }

  async fetchNextChunk() {
    if (!this.remote || this.remote.done || this.remote.fetching) return this.remote?.fetching;
    const { rangeFile } = this.source;
    this.remote.fetching = (async () => {
      const size = rangeFile.size || 0;
      if (size && this.remote.nextOffset >= size) {
        this.remote.done = true;
        return;
      }
      const start = this.remote.nextOffset;
      const end = size ? Math.min(size - 1, start + CHUNK_SIZE - 1) : start + CHUNK_SIZE - 1;
      const result = await rangeFile.fetchTextRange(start, end, this.remote.carry, this.abortController?.signal);
      this.remote.nextOffset = end + 1;
      this.remote.carry = result.carry;
      const parsed = parseCandumpText(result.text);
      appendFrames(this.frames, parsed);
      this.timelineStart = this.timelineStart ?? this.frames[0]?.timestamp ?? null;
      const parsedEnd = parsed[parsed.length - 1]?.timestamp;
      if (Number.isFinite(parsedEnd)) this.timelineEnd = Math.max(this.timelineEnd ?? parsedEnd, parsedEnd);
      if (rangeFile.lastStatus !== 206) {
        this.remote.done = true;
      }
      if (size && this.remote.nextOffset >= size) {
        if (this.remote.carry.trim()) appendFrames(this.frames, parseCandumpText(`${this.remote.carry}\n`));
        this.remote.carry = '';
        this.remote.done = true;
      }
      this.bytesFetched = rangeFile.bytesFetched;
      this.dispatch('buffer', this.metadata());
    })().finally(() => {
      if (this.remote) this.remote.fetching = null;
    });
    return this.remote.fetching;
  }

  async preloadRemote() {
    if (!this.remote || this.remote.done) return;
    const size = this.source.rangeFile.size || 0;
    const preloadLimit = size ? Math.min(size, PRELOAD_BYTES) : PRELOAD_BYTES;
    while (!this.remote.done && this.remote.nextOffset < preloadLimit) {
      await this.fetchNextChunk();
    }
  }

  async estimateTimelineEnd() {
    if (!this.remote || this.remote.done) return;
    const { rangeFile } = this.source;
    const size = rangeFile.size || 0;
    if (!size || size <= CHUNK_SIZE) return;
    const start = Math.max(0, size - CHUNK_SIZE);
    const previousStatus = rangeFile.lastStatus;
    const result = await rangeFile.fetchTextRange(start, size - 1, '', this.abortController?.signal);
    if (rangeFile.lastStatus !== 206) {
      rangeFile.lastStatus = previousStatus;
      return;
    }
    const tailFrames = parseCandumpText(result.text);
    const tailEnd = tailFrames[tailFrames.length - 1]?.timestamp;
    if (Number.isFinite(tailEnd)) this.timelineEnd = tailEnd;
    rangeFile.lastStatus = previousStatus;
  }

  metadata() {
    const first = this.timelineStart ?? this.frames[0]?.timestamp ?? null;
    const last = this.timelineEnd ?? this.frames[this.frames.length - 1]?.timestamp ?? null;
    return {
      name: this.source?.name || this.source?.log?.name || 'unknown',
      frameCount: this.frames.length,
      start: first,
      end: last,
      bytesFetched: this.bytesFetched,
      remoteSize: this.source?.rangeFile?.size ?? null,
    };
  }

  setSpeed(speed) {
    this.speed = speed;
    this.anchorClock();
  }

  setHistorySeconds(seconds) {
    if (!Number.isFinite(seconds)) return;
    this.historySeconds = Math.max(1, seconds);
  }

  play() {
    if (!this.frames.length || this.playing || this.loading) return;
    this.playing = true;
    this.anchorClock();
    this.tick();
    this.dispatch('state', { playing: true });
  }

  pause() {
    this.playing = false;
    this.dispatch('state', { playing: false });
  }

  stop() {
    this.playing = false;
    this.abortController?.abort();
  }

  step() {
    this.consumeFrame();
    this.dispatch('progress', this.progress());
  }

  seek(fraction) {
    if (!this.frames.length) return;
    const start = this.timelineStart ?? this.frames[0]?.timestamp ?? 0;
    const end = this.timelineEnd ?? this.frames[this.frames.length - 1]?.timestamp ?? start;
    const target = start + Math.max(0, Math.min(1, fraction)) * Math.max(0, end - start);
    const index = findFrameIndexAtOrAfter(this.frames, target);
    this.frameIndex = index;
    this.playheadTime = target;
    this.store.reset();
    this.decodeState = this.populateHistory(index, target - this.historySeconds);
    this.anchorClock();
    if (target > (this.frames[this.frames.length - 1]?.timestamp ?? target) && this.remote && !this.remote.done) {
      void this.fetchNextChunk();
    }
    this.dispatch('progress', this.progress());
  }

  anchorClock() {
    this.baseWall = performance.now();
    this.baseLog = this.playheadTime ?? this.frames[this.frameIndex]?.timestamp ?? 0;
  }

  tick() {
    if (!this.playing) return;
    const elapsed = ((performance.now() - this.baseWall) / 1000) * this.speed;
    const target = this.baseLog + elapsed;
    let consumed = 0;
    while (this.frameIndex < this.frames.length && this.frames[this.frameIndex].timestamp <= target) {
      this.consumeFrame();
      consumed += 1;
      if (consumed > 3000) break;
    }
    if (this.remote && !this.remote.done && this.frames.length - this.frameIndex < 250) {
      void this.fetchNextChunk();
    }
    this.dispatch('progress', this.progress());
    if (this.frameIndex >= this.frames.length) {
      if (this.remote && !this.remote.done) {
        requestAnimationFrame(() => this.tick());
      } else {
        this.pause();
      }
      return;
    }
    requestAnimationFrame(() => this.tick());
  }

  consumeFrame() {
    const frame = this.frames[this.frameIndex];
    if (!frame) return;
    this.playheadTime = frame.timestamp;
    for (const [signal, time, value] of decodeFrame(frame, this.decodeState)) {
      this.store.append(signal, time, value);
    }
    this.frameIndex += 1;
  }

  createDecodeStateAt(index) {
    const state = createDecodeState();
    const target = this.frames[index]?.timestamp;
    if (!Number.isFinite(target)) return state;
    let seed = index - 1;
    while (seed >= 0 && target - this.frames[seed].timestamp <= 1) seed -= 1;
    for (let i = seed + 1; i < index; i++) {
      state.countWindow.push(this.frames[i].timestamp);
    }
    return state;
  }

  populateHistory(index, historyStart) {
    const state = createDecodeState();
    let start = index;
    while (start > 0 && this.frames[start - 1].timestamp >= historyStart) start -= 1;
    let seed = start - 1;
    const seedTarget = this.frames[start]?.timestamp;
    while (seed >= 0 && seedTarget - this.frames[seed].timestamp <= 1) seed -= 1;
    for (let i = seed + 1; i < start; i++) state.countWindow.push(this.frames[i].timestamp);
    for (let i = start; i < index; i++) {
      const frame = this.frames[i];
      for (const [signal, time, value] of decodeFrame(frame, state)) {
        this.store.append(signal, time, value);
      }
    }
    return state;
  }

  progress() {
    const start = this.timelineStart ?? this.frames[0]?.timestamp ?? null;
    const end = this.timelineEnd ?? this.frames[this.frames.length - 1]?.timestamp ?? null;
    const current = this.currentTime();
    return {
      frameIndex: this.frameIndex,
      frameCount: this.frames.length,
      current,
      start,
      end,
      bytesFetched: this.bytesFetched,
    };
  }

  currentTime() {
    if (!this.frames.length) return null;
    if (this.playing) {
      const elapsed = ((performance.now() - this.baseWall) / 1000) * this.speed;
      const end = this.timelineEnd ?? this.frames[this.frames.length - 1]?.timestamp ?? this.baseLog;
      return Math.min(end, this.baseLog + elapsed);
    }
    return this.playheadTime ?? this.frames[Math.max(0, this.frameIndex - 1)]?.timestamp ?? this.frames[0]?.timestamp ?? null;
  }

  dispatch(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function appendFrames(target, frames) {
  for (let i = 0; i < frames.length; i++) target.push(frames[i]);
}

export function findFrameIndexAtOrAfter(frames, target) {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timestamp < target) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, Math.min(frames.length - 1, lo));
}
