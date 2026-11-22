// tiff-doc.js — T13: a .tif / .tiff as the slice of a pdf.js document the viewer, Print and Find use:
// numPages, getPage(n) -> { getViewport, render -> { promise, cancel }, getTextContent (empty) }, destroy, freePixels.
// The page list and sizes are read at open; a page's pixels are decoded when it is first drawn and kept until freed.
// A page that failed to decode stays failed (no second try) until freePixels / destroy, which also forget the failure.
import UTIF from './vendor/utif/UTIF.js';

const DECODED = [1, 3, 4, 5, 6, 7, 8, 32773, 32809]; // compressions the vendored UTIF decodes (8 = Deflate: strips are inflated first, see inflateStrips)

/** Deflate (zlib) strips / tiles of an IFD inflated with the built-in DecompressionStream: Map(byte offset -> bytes) for UTIF.inflated (UTIF's decode is synchronous). */
async function inflateStrips(buf, ifd) {
  const offs = ifd.t273 || ifd.t324, lens = ifd.t279 || ifd.t325, out = new Map();
  for (let i = 0; i < offs.length; i++) {
    const stream = new Blob([new Uint8Array(buf, offs[i], lens[i])]).stream().pipeThrough(new DecompressionStream('deflate'));
    out.set(offs[i], new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return out;
}
const MAX_PIXELS = 2 ** 28; // 1 GB of RGBA (an A0 scan at 300 dpi is 140 M): a bigger claim froze the window for minutes in the decoder
const CACHE_BYTES = 512 << 20; // shortcut: the oldest drawn pages are decoded again past 512 MB of RGBA; a smarter budget if big scans thrash

const unreadable = (name, why) => new Error(`${name}: this TIFF can't be read (${why}).`);
const cancelled = () => Object.assign(new Error('Rendering cancelled'), { name: 'RenderingCancelledException' }); // what the callers skip, as pdf.js

/** Page size in points: pixels x 72 / dpi, dpi from the resolution tags (inch or cm); no tag (or no unit): 96 dpi. */
function pageSize(ifd) {
  const unit = ifd.t296?.[0] ?? 2;
  const dpi = (res) => (res > 0 && unit !== 1 ? (unit === 3 ? res * 2.54 : res) : 96);
  return { w: (ifd.t256[0] * 72) / dpi(ifd.t282?.[0]), h: (ifd.t257[0] * 72) / dpi(ifd.t283?.[0]) };
}

/** Opens TIFF bytes. Throws Error('<name>: this TIFF can't be read (<why>).') for a file that is no TIFF, has no pages or a compression UTIF lacks. */
export function openTiff(name, bytes, cacheBytes = CACHE_BYTES) {
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  if (head !== 'II*\0' && head !== 'MM\0*') throw unreadable(name, 'not a TIFF file');
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); // UTIF copies a typed array on every call, not a buffer
  let pages;
  try { pages = UTIF.decode(buf).filter((ifd) => ifd.t256 && ifd.t257); }
  catch (e) { throw unreadable(name, e?.message || e); }
  if (!pages.length) throw unreadable(name, 'no pages');
  for (const ifd of pages) if (ifd.t259?.[0] === 32946) ifd.t259 = [8]; // Adobe's code for the same zlib data
  const odd = pages.find((ifd) => !DECODED.includes(ifd.t259?.[0] ?? 1));
  if (odd) throw unreadable(name, `compression ${odd.t259[0]} not supported`);
  const sizes = pages.map(pageSize), cache = new Map(), failed = new Map(), inflight = new Map();
  let cached = 0, generation = 0; // generation: bumped by free(), so a decode that free() overtook neither counts nor caches its page

  /** RGBA of page i (0-based), decoded once; the most recently used pages stay. Throws (once logged) when the page cannot be decoded. */
  async function decode(i) {
    const gen = generation;
    let rgba;
    try {
      if (pages[i].t256[0] * pages[i].t257[0] > MAX_PIXELS) throw new Error('over 268 million pixels');
      if (pages[i].t259?.[0] === 8) UTIF.inflated = await inflateStrips(buf, pages[i]);
      UTIF.decodeImage(buf, pages[i], pages);
      rgba = UTIF.toRGBA8(pages[i]);
    } catch (e) {
      failed.set(i, e);
      console.warn('TIFF page', i + 1, e);
      throw e;
    } finally {
      delete pages[i].data; // the raw strips: only the RGBA is kept
      UTIF.inflated = new Map(); // the last page's inflated strips
    }
    if (gen === generation) cached += rgba.length;
    return rgba;
  }

  async function pixels(i) {
    if (failed.has(i)) throw failed.get(i);
    let rgba = cache.get(i);
    if (rgba) cache.delete(i);
    else {
      const gen = generation, p = inflight.get(i) ?? inflight.set(i, decode(i)).get(i);
      try { rgba = await p; } finally { if (inflight.get(i) === p) inflight.delete(i); } // here, not in decode: a decode that never awaits ends before the set
      if (gen !== generation) return rgba; // freed while decoding: drawn, not cached
      cache.delete(i); // the second waiter re-adds it below without counting its bytes twice
    }
    cache.set(i, rgba);
    for (const [k, old] of cache) {
      if (cached <= cacheBytes || k === i) break;
      cache.delete(k);
      cached -= old.length;
    }
    return rgba;
  }

  function free() { cache.clear(); inflight.clear(); failed.clear(); cached = 0; generation++; } // failed too: a page that failed for a passing reason (memory) is decoded again

  async function getPage(n) {
    const { w, h } = sizes[n - 1], ifd = pages[n - 1];
    return {
      getViewport: ({ scale }) => ({ width: w * scale, height: h * scale, scale }),
      getTextContent: async () => ({ items: [] }), // Find gives "no matches"; no text layer is drawn (viewer.js)
      render({ canvasContext: ctx, viewport }) {
        let stop = false;
        const promise = (async () => {
          await null; // a cancel() right after render() wins
          if (stop) throw cancelled();
          let bitmap;
          try {
            const rgba = await pixels(n - 1);
            bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), ifd.width, ifd.height));
          } catch (e) {
            if (stop) throw cancelled();
            const size = Math.max(10, Math.round(viewport.width / 40));
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, viewport.width, viewport.height);
            ctx.fillStyle = '#000';
            ctx.font = `${size}px sans-serif`;
            ctx.fillText(`${name} page ${n}: this TIFF page can't be read (${e?.message || e})`, 8, 8 + size, viewport.width - 16);
            return;
          }
          try {
            if (stop) throw cancelled();
            ctx.drawImage(bitmap, 0, 0, viewport.width, viewport.height);
          } finally { bitmap.close(); }
        })();
        return { promise, cancel() { stop = true; } };
      },
    };
  }

  return { numPages: pages.length, getPage, freePixels: free, destroy: free, inflight }; // inflight: read by the unit tests
}
