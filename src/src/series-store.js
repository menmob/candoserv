export class SeriesStore {
  constructor(maxPoints = 1 << 15) {
    this.maxPoints = maxPoints;
    this.series = new Map();
    this.firstTime = null;
    this.lastTime = null;
    this.version = 0;
    this.resetCount = 0;
  }

  ensure(id) {
    let item = this.series.get(id);
    if (!item) {
      item = {
        id,
        times: new Float64Array(this.maxPoints),
        values: new Float64Array(this.maxPoints),
        offset: 0,
        length: 0,
      };
      this.series.set(id, item);
    }
    return item;
  }

  append(id, time, value) {
    const series = this.ensure(id);
    const index = (series.offset + series.length) % this.maxPoints;
    series.times[index] = time;
    series.values[index] = value;
    if (series.length < this.maxPoints) {
      series.length += 1;
    } else {
      series.offset = (series.offset + 1) % this.maxPoints;
    }
    this.firstTime = this.firstTime == null ? time : Math.min(this.firstTime, time);
    this.lastTime = this.lastTime == null ? time : Math.max(this.lastTime, time);
    this.version += 1;
  }

  reset() {
    this.series.clear();
    this.firstTime = null;
    this.lastTime = null;
    this.version += 1;
    this.resetCount += 1;
  }

  view(id) {
    const series = this.series.get(id);
    if (!series) return { times: [], values: [] };
    const times = new Array(series.length);
    const values = new Array(series.length);
    for (let i = 0; i < series.length; i++) {
      const index = (series.offset + i) % this.maxPoints;
      times[i] = series.times[index];
      values[i] = series.values[index];
    }
    return { times, values };
  }

  forEach(id, callback) {
    const series = this.series.get(id);
    if (!series) return;
    for (let i = 0; i < series.length; i++) {
      const index = (series.offset + i) % this.maxPoints;
      callback(series.times[index], series.values[index], i);
    }
  }

  length(id) {
    return this.series.get(id)?.length ?? 0;
  }
}
