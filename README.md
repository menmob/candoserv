# Telometer Replay

Static, GitHub-Pages-friendly telemetry replay UI inspired by Telometer's dashboard model.

## Run Locally

```bash
cd /Users/britmob/Documents/fsae/2026/telometer-replay
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/`.

## Structure

- `index.html` - fixed app shell
- `src/app.js` - UI wiring and application state
- `src/range-file.js` - `HEAD` metadata and `Range` `GET` byte reads
- `src/catalog.js` - static directory listing parser
- `src/candump.js` - candump line parser
- `src/signals.js` - signal registry and CAN frame decoding
- `src/replay.js` - replay clock, incremental range buffering, decode loop
- `src/series-store.js` - typed-array ring buffers
- `src/plot.js` - responsive canvas plot
- `src/styles.css` - Telometer-like dashboard theme
- `tests/parser.test.mjs` - parser/decode smoke tests
- `assets/driving-candump-2025-09-30_151555.log` - bundled full driving log

## Cloudflare CORS

GitHub Pages can host this app, but `logs.goatfastracing.com` must expose CORS:

```http
Access-Control-Allow-Origin: https://YOUR_ORG.github.io
Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, Last-Modified, ETag
```

The app uses `HEAD` for metadata and `GET` with a single `Range` header for data. It does not need credentials.

## Test

```bash
node tests/parser.test.mjs
```

## Bundled Driving Log Heuristic

`driving-candump-2025-09-30_151555.log` was selected from `logs.goatfastracing.com`
because it is compact enough to bundle but still shows real driving activity:

- 607,825 candump frames over 170.509 seconds
- Maximum timestamp gap is 4.258 ms
- 38 distinct CAN IDs
- 67,869 wheel-speed frames with a 1,020,802 raw-count spread
- 35,850 pedal frames with changing throttle/brake values
- 119,297 inverter frames
