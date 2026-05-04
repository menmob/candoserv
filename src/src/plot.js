import uPlot from '../vendor/uplot/uPlot.esm.js';
import { SIGNAL_BY_ID } from './signals.js';
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
    this.uplot = null;

    this.canvas.style.display = 'none';
    this.root = canvas.parentElement;
    this.root.classList.add('uplot-wrap');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.root);
  }

  setSignals(ids) {
    this.selected = new Set(ids);
    this.resetChart();
    this.requestDraw();
  }

  toggleSignal(id, enabled) {
    if (enabled) this.selected.add(id);
    else this.selected.delete(id);
    this.resetChart();
    this.requestDraw();
  }

  clear() {
    this.selected.clear();
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
    const ids = [...this.selected];
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
    this.uplot.setData(data, false);
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
    const scales = { x: { time: false } };
    const series = [
      {},
      ...ids.map((id) => {
        const signal = SIGNAL_BY_ID[id];
        scales[id] = { auto: true };
        return {
          label: signal?.label || id,
          scale: id,
          stroke: signal?.color || '#ffffff',
          width: 1.6,
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
    const bucketCount = Math.max(16, Math.floor(width - 56));
    const span = range.maxT - range.minT;
    const x = [];
    const ys = ids.map(() => []);
    const buckets = ids.map(() => Array.from({ length: bucketCount }, () => ({ sum: 0, count: 0 })));

    ids.forEach((id, seriesIndex) => {
      this.store.forEach(id, (t, v) => {
        if (!Number.isFinite(t) || !Number.isFinite(v) || t < range.minT || t > range.maxT) return;
        const index = Math.max(0, Math.min(bucketCount - 1, Math.floor(((t - range.minT) / span) * bucketCount)));
        buckets[seriesIndex][index].sum += v;
        buckets[seriesIndex][index].count += 1;
      });
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
}
