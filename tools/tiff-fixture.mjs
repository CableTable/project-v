// tiff-fixture.mjs: small TIFFs written in code for the T13 tests (no binary fixtures in the repo).

/** Run-length (PackBits) encoding: a repeat packet per run, a 1-byte literal otherwise. */
function packBits(raw) {
  const out = [];
  for (let i = 0; i < raw.length;) {
    let n = 1;
    while (n < 128 && raw[i + n] === raw[i]) n++;
    out.push(n > 1 ? 257 - n : 0, raw[i]);
    i += n;
  }
  return Uint8Array.from(out);
}

/** pages: [{ w, h, rgb: [r, g, b] | gray: 0-255, packBits, compression, dpi: [x, y], unit }] -> little-endian TIFF bytes, one solid colour strip per page.
 *  `compression` only sets the tag, the strip stays raw (a refused or broken page); `loop`: the last IFD links back to the first (a corrupt file). */
export function makeTiff(pages, { loop = false } = {}) {
  const buf = new Uint8Array(8 + pages.reduce((n, p) => n + 400 + p.w * p.h * 6, 0)), dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49, 42, 0]);
  let at = 8, link = 4;
  for (const p of pages) {
    const spp = p.gray === undefined ? 3 : 1, raw = new Uint8Array(p.w * p.h * spp);
    for (let i = 0; i < raw.length; i++) raw[i] = spp === 1 ? p.gray : p.rgb[i % 3];
    const strip = p.packBits ? packBits(raw) : raw;
    const tags = [[256, 4, [p.w]], [257, 4, [p.h]], [258, 3, Array(spp).fill(8)], [259, 3, [p.compression ?? (p.packBits ? 32773 : 1)]],
      [262, 3, [spp === 3 ? 2 : 1]], [273, 4, [0]], [277, 3, [spp]], [278, 4, [p.h]], [279, 4, [strip.length]]];
    if (p.dpi) tags.push([282, 5, [p.dpi[0]]], [283, 5, [p.dpi[1]]], [296, 3, [p.unit ?? 2]]);
    dv.setUint32(link, at, true);
    let extra = at + 2 + tags.length * 12 + 4, stripAt = 0;
    dv.setUint16(at, tags.length, true);
    tags.forEach(([tag, type, values], k) => {
      const e = at + 2 + k * 12, size = { 3: 2, 4: 4, 5: 8 }[type];
      dv.setUint16(e, tag, true);
      dv.setUint16(e + 2, type, true);
      dv.setUint32(e + 4, values.length, true);
      let v = e + 8;
      if (size * values.length > 4) { dv.setUint32(v, extra, true); v = extra; extra += size * values.length; }
      values.forEach((x, j) => {
        if (type === 3) dv.setUint16(v + 2 * j, x, true);
        else if (type === 4) dv.setUint32(v + 4 * j, x, true);
        else { dv.setUint32(v + 8 * j, x, true); dv.setUint32(v + 8 * j + 4, 1, true); }
      });
      if (tag === 273) stripAt = v;
    });
    link = at + 2 + tags.length * 12;
    dv.setUint32(stripAt, extra, true);
    buf.set(strip, extra);
    at = extra + strip.length;
    at += at & 1;
  }
  if (loop) dv.setUint32(link, dv.getUint32(4, true), true);
  return buf.slice(0, at);
}
