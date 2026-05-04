import uPlot from '../vendor/uplot/uPlot.esm.js';
import { SIGNAL_BY_ID, SIGNAL_ORDER } from './signals.js?v=20260504-history-dbc4';
import { formatClock } from './dom.js';

const MIN_WINDOW_SECONDS = 1;
const MAX_WINDOW_SECONDS = 120;

export class PlotCanvas {
  constructor(canvas, readout, store) {
    this.canvas = canvas;
    this.readout = readout;
    this.store = store;
    this.selected = new Set();
    this.dirty = true;
    this.windowSeconds = 10;
    this.playheadTime = null;
    this.xRange = null;
    this.lastKey = '';
    this.lastData = null;
    this.valueBounds = new Map();
    this.uplot = null;

    this.canvas.style.display = 'none';
    this.root = canvas.parentElement;
    this.root.classList.add('uplot-wrap');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.root);
  }

  setSignals(ids) {
    this.selected = new Set(ids);
    this.valueBounds.clear();
    this.resetChart();
    this.requestDraw();
  }

  toggleSignal(id, enabled) {
    if (enabled) this.selected.add(id);
    else this.selected.delete(id);
    this.valueBounds.clear();
    this.resetChart();
    this.requestDraw();
  }

  clear() {
    this.selected.clear();
    this.valueBounds.clear();
    this.resetChart();
    this.requestDraw();
  }

  hasRange() {
    return Boolean(this.xRange);
  }

  setPlayhead(time, follow = false) {
    if (!Number.isFinite(time)) return;
    this.playheadTime = time;
    if (follow || !this.xRange) this.setHistoryRange(time);
  }

  setWindowSeconds(seconds) {
    const next = Math.max(MIN_WINDOW_SECONDS, Math.min(MAX_WINDOW_SECONDS, seconds));
    if (next === this.windowSeconds) return this.windowSeconds;
    this.windowSeconds = next;
    this.valueBounds.clear();
    if (Number.isFinite(this.playheadTime)) this.setHistoryRange(this.playheadTime);
    else this.requestDraw();
    return this.windowSeconds;
  }

  zoomIn() {
    return this.setWindowSeconds(this.windowSeconds / 2);
  }

  zoomOut() {
    return this.setWindowSeconds(this.windowSeconds * 2);
  }

  fitToData() {
    this.xRange = null;
    this.valueBounds.clear();
    this.requestDraw();
  }

  setHistoryRange(time) {
    this.setRange(time - this.windowSeconds, time);
  }

  setRange(minT, maxT) {
    if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return;
    const next = { minT, maxT: Math.max(minT + 0.001, maxT) };
    if (this.xRange && this.xRange.minT === next.minT && this.xRange.maxT === next.maxT) return;
    this.xRange = next;
    this.requestDraw();
  }

  requestDraw() {
    this.dirty = true;
  }

  resize() {
    if (!this.uplot) {
      this.requestDraw();
      return;
    }
    const { width, height } = this.size();
    this.uplot.setSize({ width, height });
    this.requestDraw();
  }

  draw() {
    this.dirty = false;
    const ids = this.orderedSelected();
    const { width, height } = this.size();
    if (!ids.length || width <= 0 || height <= 0) {
      this.destroyChart();
      this.readout.textContent = ids.length ? 'Waiting for samples' : 'Drop or select signals';
      return;
    }

    const range = this.resolveTimeRange(ids);
    if (!range) {
      this.destroyChart();
      this.readout.textContent = 'Waiting for samples';
      return;
    }

    const data = this.buildData(ids, range, width);
    if (!data[0].length) {
      this.destroyChart();
      this.readout.textContent = 'Waiting for samples';
      return;
    }

    this.ensureChart(ids, width, height);
    this.uplot.setData(this.normalizeData(ids, data), false);
    this.uplot.setScale('x', { min: range.minT, max: range.maxT });
    this.readout.textContent = `${formatClock(range.maxT - range.minT)} history`;
  }

  ensureChart(ids, width, height) {
    const key = ids.join('|');
    if (this.uplot && this.lastKey === key) return;
    this.destroyChart();
    this.lastKey = key;
    this.uplot = new uPlot(this.options(ids, width, height), [[]], this.root);
  }

  destroyChart() {
    if (this.uplot) {
      this.uplot.destroy();
      this.uplot = null;
    }
    this.lastKey = '';
  }

  resetChart() {
    this.lastData = null;
    this.destroyChart();
  }

  options(ids, width, height) {
    const scales = {
      x: { time: false },
      y: { auto: false, min: 0, max: 1 },
    };
    const series = [
      {},
      ...ids.map((id) => {
        const signal = SIGNAL_BY_ID[id];
        return {
          label: signal?.label || id,
          scale: 'y',
          stroke: signal?.color || '#ffffff',
          width: 1.6,
          spanGaps: true,
          points: { show: false },
        };
      }),
    ];

    return {
      width,
      height,
      padding: [14, 14, 22, 42],
      scales,
      series,
      axes: [
        {
          scale: 'x',
          stroke: '#8993a6',
          grid: { stroke: '#1d2430', width: 1 },
          ticks: { stroke: '#313a49', width: 1 },
          values: (_u, vals) => vals.map((v) => formatClock(v - (_u.scales.x.min ?? v))),
        },
        { scale: 'y', show: false, grid: { show: false } },
      ],
      cursor: {
        drag: { x: false, y: false },
        points: { show: false },
      },
      hooks: {
        setCursor: [
          (u) => {
            const left = u.cursor.left;
            if (left == null) return;
            const time = u.posToVal(left, 'x');
            this.readout.textContent = `${formatClock(time - (u.scales.x.min ?? time))}  ${time.toFixed(6)}`;
          },
        ],
      },
      legend: { show: true },
    };
  }

  resolveTimeRange(ids) {
    if (this.xRange) return this.xRange;
    let minT = Infinity;
    let maxT = -Infinity;
    for (const id of ids) {
      this.store.forEach(id, (t, v) => {
        if (!Number.isFinite(t) || !Number.isFinite(v)) return;
        minT = Math.min(minT, t);
        maxT = Math.max(maxT, t);
      });
    }
    if (!Number.isFinite(minT)) return null;
    if (minT === maxT) maxT = minT + 1;
    return { minT, maxT };
  }

  buildData(ids, range, width) {
    const visible = this.collectVisible(ids, range);
    const rawPointCount = visible.reduce((sum, series) => sum + series.length, 0);
    if (rawPointCount <= Math.max(8000, width * 8)) return buildRawAligned(visible);

    const bucketCount = Math.max(16, Math.floor(width - 56));
    const span = range.maxT - range.minT;
    const x = [];
    const ys = ids.map(() => []);
    const buckets = ids.map(() => Array.from({ length: bucketCount }, () => ({ sum: 0, count: 0 })));

    visible.forEach((series, seriesIndex) => {
      for (const [t, v] of series) {
        const index = Math.max(0, Math.min(bucketCount - 1, Math.floor(((t - range.minT) / span) * bucketCount)));
        buckets[seriesIndex][index].sum += v;
        buckets[seriesIndex][index].count += 1;
      }
    });

    for (let i = 0; i < bucketCount; i++) {
      x.push(range.minT + ((i + 0.5) / bucketCount) * span);
      for (let s = 0; s < ids.length; s++) {
        const bucket = buckets[s][i];
        ys[s].push(bucket.count ? bucket.sum / bucket.count : null);
      }
    }

    return [x, ...ys];
  }

  collectVisible(ids, range) {
    return ids.map((id) => {
      const samples = [];
      this.store.forEach(id, (t, v) => {
        if (!Number.isFinite(t) || !Number.isFinite(v) || t < range.minT || t > range.maxT) return;
        samples.push([t, v]);
      });
      return samples;
    });
  }

  normalizeData(ids, data) {
    const out = [data[0], ...ids.map(() => [])];
    const laneGap = ids.length > 1 ? 0.025 : 0.08;
    const laneHeight = ids.length > 1
      ? (1 - laneGap * (ids.length + 1)) / ids.length
      : 1 - laneGap * 2;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const values = data[i + 1];
      let min = Infinity;
      let max = -Infinity;
      for (const value of values) {
        if (!Number.isFinite(value)) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      if (!Number.isFinite(min)) continue;
      if (min === max) {
        min -= 1;
        max += 1;
      }
      const pad = (max - min) * 0.08;
      const next = { min: min - pad, max: max + pad };
      const previous = this.valueBounds.get(id);
      const stable = previous
        ? { min: Math.min(previous.min, next.min), max: Math.max(previous.max, next.max) }
        : next;
      this.valueBounds.set(id, stable);

      const laneBase = ids.length > 1
        ? 1 - laneGap * (i + 1) - laneHeight * (i + 1)
        : laneGap;
      const denom = stable.max - stable.min || 1;
      out[i + 1] = values.map((value) => {
        if (!Number.isFinite(value)) return null;
        return laneBase + ((value - stable.min) / denom) * laneHeight;
      });
    }
    return out;
  }

  size() {
    const panel = this.root.closest('.plot-panel');
    const title = panel?.querySelector('.panel-title');
    const rect = this.root.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const titleRect = title?.getBoundingClientRect();
    const rawHeight = (panelRect?.height ?? rect.height) - (titleRect?.height ?? 0);
    const viewportHeight = Math.max(260, window.innerHeight - rect.top - 120);
    return {
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(Math.min(rawHeight, viewportHeight))),
    };
  }

  orderedSelected() {
    return [...this.selected].sort((a, b) => {
      const ai = SIGNAL_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bi = SIGNAL_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi || a.localeCompare(b);
    });
  }
}

function buildRawAligned(visible) {
  const rows = new Map();
  for (let seriesIndex = 0; seriesIndex < visible.length; seriesIndex++) {
    for (const [t, v] of visible[seriesIndex]) {
      let row = rows.get(t);
      if (!row) {
        row = new Array(visible.length).fill(null);
        rows.set(t, row);
      }
      row[seriesIndex] = v;
    }
  }

  const times = [...rows.keys()].sort((a, b) => a - b);
  const ys = visible.map(() => new Array(times.length).fill(null));
  for (let i = 0; i < times.length; i++) {
    const row = rows.get(times[i]);
    for (let s = 0; s < visible.length; s++) ys[s][i] = row[s];
  }
  return [times, ...ys];
}
