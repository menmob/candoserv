import { DEFAULT_CATALOG_URL, DRIVING_LOG, INITIAL_SIGNALS, SAMPLE_LOG, SAMPLE_LOG_NAME } from './config.js?v=20260504-history-dbc4';
import { $, el, formatBytes, formatClock, setNotice } from './dom.js';
import { loadCatalog, logSubtitle } from './catalog.js';
import { RangeFile } from './range-file.js?v=20260504-history-dbc4';
import { ReplayEngine } from './replay.js?v=20260504-history-dbc4';
import { SeriesStore } from './series-store.js?v=20260504-history-perf';
import { PlotCanvas } from './plot.js?v=20260504-history-dbc4';
import { SIGNALS } from './signals.js?v=20260504-history-dbc4';

const nodes = {
  catalogUrl: $('#catalogUrl'),
  refreshCatalog: $('#refreshCatalog'),
  loadCatalog: $('#loadCatalog'),
  logFilter: $('#logFilter'),
  catalogError: $('#catalogError'),
  logList: $('#logList'),
  activeLogName: $('#activeLogName'),
  activeLogMeta: $('#activeLogMeta'),
  corsStatus: $('#corsStatus'),
  cacheStatus: $('#cacheStatus'),
  statusText: $('#statusText'),
  playPause: $('#playPause'),
  stepFrame: $('#stepFrame'),
  speedSelect: $('#speedSelect'),
  timeScrub: $('#timeScrub'),
  timeReadout: $('#timeReadout'),
  frameReadout: $('#frameReadout'),
  fetchReadout: $('#fetchReadout'),
  signalList: $('#signalList'),
  signalFilter: $('#signalFilter'),
  selectCore: $('#selectCore'),
  clearSignals: $('#clearSignals'),
  fitView: $('#fitView'),
  zoomIn: $('#zoomIn'),
  zoomOut: $('#zoomOut'),
  windowReadout: $('#windowReadout'),
};

const store = new SeriesStore();
const replay = new ReplayEngine(store);
const plot = new PlotCanvas($('#plotCanvas'), $('#cursorReadout'), store);
const PLOT_FRAME_MS = 30;
let catalog = [];
let statusSerial = 0;
let lastReadoutUpdate = 0;
let lastPlotDraw = 0;

function init() {
  nodes.catalogUrl.value = DEFAULT_CATALOG_URL;
  wireEvents();
  plot.setSignals(INITIAL_SIGNALS);
  renderSignals();
  void loadLog(DRIVING_LOG);
  setNotice(nodes.catalogError, 'Remote catalog is not loaded automatically. Use Load after Cloudflare CORS is enabled.');
  nodes.corsStatus.textContent = 'local log';
  nodes.corsStatus.className = 'status-pill status-muted';
  renderLogs();
  animate();
}

function wireEvents() {
  nodes.loadCatalog.addEventListener('click', () => refreshCatalog());
  nodes.refreshCatalog.addEventListener('click', () => refreshCatalog());
  nodes.logFilter.addEventListener('input', () => renderLogs());
  nodes.signalFilter.addEventListener('input', () => renderSignals());
  nodes.selectCore.addEventListener('click', () => {
    plot.setSignals(INITIAL_SIGNALS);
    renderSignals();
  });
  nodes.clearSignals.addEventListener('click', () => {
    plot.clear();
    renderSignals();
  });
  nodes.fitView.addEventListener('click', () => plot.fitToData());
  nodes.zoomIn.addEventListener('click', () => setPlotWindow(plot.zoomIn()));
  nodes.zoomOut.addEventListener('click', () => setPlotWindow(plot.zoomOut()));
  nodes.playPause.addEventListener('click', () => {
    if (replay.playing) replay.pause();
    else replay.play();
  });
  nodes.stepFrame.addEventListener('click', () => replay.step());
  nodes.speedSelect.addEventListener('change', () => replay.setSpeed(Number(nodes.speedSelect.value)));
  nodes.timeScrub.addEventListener('input', () => {
    replay.seek(Number(nodes.timeScrub.value) / 100000);
    plot.setPlayhead(replay.currentTime(), true);
  });
  replay.addEventListener('loading', (event) => onLoading(event.detail));
  replay.addEventListener('loaded', (event) => onLoaded(event.detail));
  replay.addEventListener('buffer', (event) => onBuffer(event.detail));
  replay.addEventListener('progress', (event) => onProgress(event.detail));
  replay.addEventListener('state', (event) => {
    nodes.playPause.textContent = event.detail.playing ? 'Pause' : 'Play';
    if (event.detail.playing) plot.setPlayhead(replay.currentTime(), true);
  });
}

async function refreshCatalog() {
  const serial = ++statusSerial;
  const url = nodes.catalogUrl.value.trim() || DEFAULT_CATALOG_URL;
  setStatus('Loading catalog...');
  setNotice(nodes.catalogError, '');
  try {
    catalog = await loadCatalog(url);
    nodes.corsStatus.textContent = 'CORS ok';
    nodes.corsStatus.className = 'status-pill status-good';
    if (serial === statusSerial) setStatus(`Loaded ${catalog.length} logs.`);
  } catch (error) {
    catalog = [];
    nodes.corsStatus.textContent = 'CORS blocked';
    nodes.corsStatus.className = 'status-pill status-warn';
    setNotice(
      nodes.catalogError,
      `Could not read the remote catalog from this origin. Add CORS on Cloudflare, or use the embedded sample. ${error.message}`,
    );
    if (serial === statusSerial) setStatus('Remote catalog unavailable. Bundled driving log remains active.');
  }
  renderLogs();
}

function renderLogs() {
  const filter = nodes.logFilter.value.trim().toLowerCase();
  nodes.logList.replaceChildren();

  const sample = logRow({
    ...DRIVING_LOG,
    subtitle: `bundled driving · ${Math.round(DRIVING_LOG.heuristic.durationSeconds)}s · ${DRIVING_LOG.heuristic.frames.toLocaleString()} frames`,
  });
  nodes.logList.append(sample);

  const tinySample = logRow({
    name: SAMPLE_LOG_NAME,
    size: new TextEncoder().encode(SAMPLE_LOG).byteLength,
    modified: 'embedded',
    sample: true,
    subtitle: 'tiny parser/playback sample',
  });
  nodes.logList.append(tinySample);

  for (const log of catalog.filter((item) => item.name.toLowerCase().includes(filter)).slice(0, 300)) {
    nodes.logList.append(logRow(log));
  }
}

function logRow(log) {
  const row = el('button', 'log-row');
  const name = el('span', 'log-name', log.name);
  const meta = el('span', 'log-meta', log.subtitle || (log.sample ? `${formatBytes(log.size)} · local sample` : logSubtitle(log)));
  row.append(name, meta);
  row.addEventListener('click', () => loadLog(log));
  return row;
}

async function loadLog(log) {
  const serial = ++statusSerial;
  setStatus(`Loading ${log.name}...`);
  try {
    if (log.sample) {
      replay.loadSample(SAMPLE_LOG_NAME, SAMPLE_LOG);
      return;
    }
    const rangeFile = new RangeFile(new URL(log.url, window.location.href).toString());
    await replay.loadRemote(log, rangeFile);
    if (rangeFile.lastStatus === 206) {
      nodes.corsStatus.textContent = 'range ok';
      nodes.corsStatus.className = 'status-pill status-good';
    } else {
      nodes.corsStatus.textContent = 'full fetch';
      nodes.corsStatus.className = 'status-pill status-muted';
    }
  } catch (error) {
    nodes.corsStatus.textContent = 'range blocked';
    nodes.corsStatus.className = 'status-pill status-warn';
    if (serial === statusSerial) setStatus(`Could not load log: ${error.message}`);
  }
}

function renderSignals() {
  const filter = nodes.signalFilter.value.trim().toLowerCase();
  nodes.signalList.replaceChildren();
  const groups = groupSignals(
    SIGNALS.filter((signal) => `${signal.label} ${signal.group} ${signal.id}`.toLowerCase().includes(filter)),
  );
  for (const [group, signals] of groups) {
    const section = el('section', 'signal-group');
    section.append(el('h3', null, group));
    for (const signal of signals) {
      const label = el('label', 'signal-row');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = plot.selected.has(signal.id);
      input.addEventListener('change', () => {
        plot.toggleSignal(signal.id, input.checked);
        renderSignals();
      });
      const swatch = el('span', 'swatch');
      swatch.style.background = signal.color;
      const text = el('span', 'signal-text', signal.label);
      const unit = el('span', 'unit', signal.unit);
      label.append(input, swatch, text, unit);
      section.append(label);
    }
    nodes.signalList.append(section);
  }
}

function onLoading(meta) {
  nodes.activeLogName.textContent = meta.name;
  nodes.activeLogMeta.textContent = 'Loading metadata and first replay window...';
  nodes.cacheStatus.textContent = 'loading';
  nodes.cacheStatus.className = 'status-pill status-muted';
  nodes.playPause.disabled = true;
  nodes.stepFrame.disabled = true;
  nodes.timeScrub.disabled = true;
  plot.requestDraw();
}

function onLoaded(meta) {
  nodes.activeLogName.textContent = meta.name;
  nodes.activeLogMeta.textContent = `${meta.frameCount.toLocaleString()} buffered frames${meta.remoteSize ? ` · ${formatBytes(meta.remoteSize)} source` : ''}`;
  nodes.cacheStatus.textContent = 'decoded reset';
  nodes.cacheStatus.className = 'status-pill status-muted';
  nodes.timeScrub.value = '0';
  nodes.playPause.disabled = false;
  nodes.stepFrame.disabled = false;
  nodes.timeScrub.disabled = false;
  onProgress(replay.progress());
  setStatus(`Loaded ${meta.name}.`);
  plot.requestDraw();
}

function onBuffer(meta) {
  nodes.activeLogMeta.textContent = `${meta.frameCount.toLocaleString()} buffered frames${meta.remoteSize ? ` · ${formatBytes(meta.remoteSize)} source` : ''}`;
  nodes.cacheStatus.textContent = 'range buffered';
  nodes.cacheStatus.className = 'status-pill status-good';
}

function onProgress(progress) {
  const span = progress.start != null && progress.end != null ? progress.end - progress.start : 0;
  const fraction = span > 0 && progress.current != null ? Math.floor(((progress.current - progress.start) / span) * 100000) : 0;
  if (document.activeElement !== nodes.timeScrub) nodes.timeScrub.value = String(fraction);
  const rel = progress.current != null && progress.start != null ? progress.current - progress.start : NaN;
  const now = performance.now();
  if (now - lastReadoutUpdate > 80 || !replay.playing) {
    nodes.timeReadout.textContent = formatClock(rel);
    nodes.frameReadout.textContent = `${progress.frameIndex.toLocaleString()}/${progress.frameCount.toLocaleString()} frames`;
    nodes.fetchReadout.textContent = `${formatBytes(progress.bytesFetched)} fetched`;
    lastReadoutUpdate = now;
  }
  plot.setPlayhead(progress.current, replay.playing || !plot.hasRange() || document.activeElement === nodes.timeScrub);
  plot.requestDraw();
}

function animate() {
  const now = performance.now();
  if (plot.dirty && (!replay.playing || now - lastPlotDraw >= PLOT_FRAME_MS)) {
    plot.draw();
    lastPlotDraw = now;
  }
  requestAnimationFrame(animate);
}

function setStatus(message) {
  nodes.statusText.textContent = message;
}

function setPlotWindow(seconds) {
  replay.setHistorySeconds(Math.max(seconds, 20));
  nodes.windowReadout.textContent = `${formatWindowSeconds(seconds)}`;
}

function formatWindowSeconds(seconds) {
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)}m`;
}

function groupSignals(signals) {
  const groups = new Map();
  for (const signal of signals) {
    const group = groups.get(signal.group) || [];
    group.push(signal);
    groups.set(signal.group, group);
  }
  return groups;
}

init();
