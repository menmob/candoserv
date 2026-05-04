export class RangeFile {
  constructor(url) {
    this.url = url;
    this.size = null;
    this.lastModified = null;
    this.acceptRanges = false;
    this.bytesFetched = 0;
  }

  async head() {
    const response = await fetch(this.url, {
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit',
      cache: 'default',
    });
    if (!response.ok) throw new Error(`HEAD failed: ${response.status}`);
    this.size = Number(response.headers.get('content-length'));
    this.lastModified = response.headers.get('last-modified');
    this.acceptRanges = /bytes/i.test(response.headers.get('accept-ranges') || '');
    return {
      size: this.size,
      lastModified: this.lastModified,
      acceptRanges: this.acceptRanges,
    };
  }

  async fetchRange(start, endInclusive, signal) {
    const response = await fetch(this.url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'default',
      signal,
      headers: {
        Range: `bytes=${Math.max(0, start)}-${Math.max(start, endInclusive)}`,
      },
    });
    if (!(response.ok || response.status === 206)) {
      throw new Error(`Range GET failed: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    this.lastStatus = response.status;
    this.bytesFetched += buffer.byteLength;
    return new Uint8Array(buffer);
  }

  async fetchTextRange(start, endInclusive, carry = '', signal) {
    const bytes = await this.fetchRange(start, endInclusive, signal);
    const text = new TextDecoder().decode(bytes);
    const merged = carry + text;
    const lastNewline = merged.lastIndexOf('\n');
    if (lastNewline < 0) return { text: '', carry: merged };
    return {
      text: merged.slice(0, lastNewline + 1),
      carry: merged.slice(lastNewline + 1),
    };
  }
}
