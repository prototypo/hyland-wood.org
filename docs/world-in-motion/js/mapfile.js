// One map file (.pmtiles), as a source for the PMTiles library. The map asks the server for the parts that it needs.
// Some servers send a part in a form that a browser cannot read: GitHub Pages behind Cloudflare sends a part of
// the gzip form of the file. Then the whole file loads, one time, and the parts come from it.
// ponytail: a whole file stays in memory (4 MB at most, 31 MB for all files); free it with its band if that is too much.
const MAGIC = [0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73]; // "PMTiles": the start of each map file

export class MapFile {
  static noParts = false; // the server of this page cannot send parts: the next file does not ask for one

  constructor(url, parts) { this.url = url; this.parts = parts; } // parts: the source of the library that asks for parts
  getKey() { return this.url; }

  async getBytes(offset, length, signal, etag) {
    if (!MapFile.noParts && !this.whole) {
      try {
        const part = await this.parts.getBytes(offset, length, signal, etag);
        const start = new Uint8Array(part.data);
        if (offset || MAGIC.every((b, i) => start[i] === b)) return part;
      } catch (e) {
        if (e.name === "AbortError" || e.constructor.name === "EtagMismatch") throw e; // the map stopped the request, or the file changed
      }
    }
    this.whole ??= fetch(this.url).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
    const data = await this.whole.catch((e) => { this.whole = null; throw e; }); // a failure is not kept: the next request tries again
    MapFile.noParts = true;
    return { data: data.slice(offset, offset + length) };
  }
}
