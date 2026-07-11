// Self-contained PPTX (PowerPoint OpenXML) writer — image-per-slide. Each Folio
// page is rendered to a PNG (by the caller, via the existing resvg path) and
// placed full-bleed on one slide, so the deck is pixel-faithful and opens in
// PowerPoint / Keynote / Google Slides.
//
// Deliberately DEPENDENCY-FREE: a .pptx is a ZIP of OOXML parts, so we assemble
// the parts as strings and pack them with a tiny STORED-zip writer (no deflate,
// no jszip). This keeps deploy = `docker cp src` (no image rebuild for a new npm
// dep). Native editable-text export (mapping layers → DrawingML shapes) is a
// future enhancement; image-per-slide is the robust, faithful baseline that PDF
// (also raster) already proves out — PPTX adds the editable-container handoff.
//
// Pure — no I/O. Returns a Buffer the caller writes to disk.

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PX = 9525;   // 914400 EMU/inch ÷ 96 px/inch
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A native (editable, selectable) text box overlaid on the slide image. Coords
 *  are source px; the background raster is rendered WITHOUT these layers so the
 *  text isn't drawn twice. */
export interface PptxText {
  text: string;              // may contain \n for multiple paragraphs
  x: number; y: number; w: number; h: number;   // px
  sizePt: number;            // font size in points
  color: string;             // #RRGGBB
  bold?: boolean;
  italic?: boolean;
  align?: 'l' | 'ctr' | 'r';
  valign?: 't' | 'ctr' | 'b';
  font?: string;
}

export interface PptxSlide {
  /** PNG bytes for the full-slide image (background — excludes any `texts`). */
  png: Buffer;
  /** Source page pixel dimensions (used for the slide size + aspect). */
  width: number;
  height: number;
  /** Native text boxes drawn over the image (WP-5.1 — editable/selectable). */
  texts?: PptxText[];
}

// ── STORED zip (method 0) — the only container a .pptx needs ──────────────────
interface ZipEntry { name: string; data: Buffer }

let CRC_TABLE: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const size = e.data.length;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // method: STORED
    local.writeUInt16LE(0, 10);          // mod time
    local.writeUInt16LE(0x21, 12);       // mod date (valid: 1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);       // compressed == uncompressed
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);          // extra len
    name.copy(local, 30);
    locals.push(local, e.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // version made by
    central.writeUInt16LE(20, 6);        // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);        // extra
    central.writeUInt16LE(0, 32);        // comment
    central.writeUInt16LE(0, 34);        // disk #
    central.writeUInt16LE(0, 36);        // internal attrs
    central.writeUInt32LE(0, 38);        // external attrs
    central.writeUInt32LE(offset, 42);   // local header offset
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + e.data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

// ── OOXML parts ──────────────────────────────────────────────────────────────
const esc = (s: string): string => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

const EMPTY_TREE =
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

function contentTypes(n: number): string {
  const slides = Array.from({ length: n }, (_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  return XML + `<Types xmlns="${CT}">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    slides + `</Types>`;
}

function rootRels(): string {
  return XML + `<Relationships xmlns="${PR}">` +
    `<Relationship Id="rId1" Type="${RT}/officeDocument" Target="ppt/presentation.xml"/>` +
    `</Relationships>`;
}

function presentation(n: number, cx: number, cy: number): string {
  const sldIds = Array.from({ length: n }, (_, i) =>
    `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('');
  return XML + `<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId${n + 1}"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${sldIds}</p:sldIdLst>` +
    `<p:sldSz cx="${cx}" cy="${cy}"/>` +
    `<p:notesSz cx="6858000" cy="9144000"/>` +
    `</p:presentation>`;
}

function presentationRels(n: number): string {
  const slides = Array.from({ length: n }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="${RT}/slide" Target="slides/slide${i + 1}.xml"/>`).join('');
  return XML + `<Relationships xmlns="${PR}">` + slides +
    `<Relationship Id="rId${n + 1}" Type="${RT}/slideMaster" Target="slideMasters/slideMaster1.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="${RT}/presProps" Target="presProps.xml"/>` +
    `</Relationships>`;
}

function slideMaster(): string {
  return XML + `<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">` +
    `<p:cSld><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
    `</p:sldMaster>`;
}
function slideMasterRels(): string {
  return XML + `<Relationships xmlns="${PR}">` +
    `<Relationship Id="rId1" Type="${RT}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    `<Relationship Id="rId2" Type="${RT}/theme" Target="../theme/theme1.xml"/>` +
    `</Relationships>`;
}
function slideLayout(): string {
  return XML + `<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="blank" preserve="1">` +
    `<p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:sldLayout>`;
}
function slideLayoutRels(): string {
  return XML + `<Relationships xmlns="${PR}">` +
    `<Relationship Id="rId1" Type="${RT}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
    `</Relationships>`;
}
function presProps(): string {
  return XML + `<p:presentationPr xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"/>`;
}

function theme(): string {
  const ph = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`;
  const acc = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
  return XML + `<a:theme xmlns:a="${A}" name="Folio">` +
    `<a:themeElements>` +
    `<a:clrScheme name="Folio">` +
    `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
    `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
    `<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
    acc.map((c, i) => `<a:accent${i + 1}><a:srgbClr val="${c}"/></a:accent${i + 1}>`).join('') +
    `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>` +
    `</a:clrScheme>` +
    `<a:fontScheme name="Folio">` +
    `<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>` +
    `</a:fontScheme>` +
    `<a:fmtScheme name="Folio">` +
    `<a:fillStyleLst>${ph}${ph}${ph}</a:fillStyleLst>` +
    `<a:lnStyleLst>` +
    `<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
    `<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
    `<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>` +
    `</a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst>${ph}${ph}${ph}</a:bgFillStyleLst>` +
    `</a:fmtScheme>` +
    `</a:themeElements>` +
    `</a:theme>`;
}

function hex6(c: string): string {
  const m = /^#?([0-9a-fA-F]{6})/.exec(c.trim());
  if (m) return m[1].toUpperCase();
  const m3 = /^#?([0-9a-fA-F]{3})$/.exec(c.trim());
  if (m3) return m3[1].split('').map(ch => ch + ch).join('').toUpperCase();
  return '000000';
}

// A native text box (<p:sp> txBox) — editable + selectable in PowerPoint/Impress.
function textShapeXml(t: PptxText, id: number): string {
  const off = (v: number): number => Math.round(v * EMU_PER_PX);
  const sz = Math.max(100, Math.round(t.sizePt * 100));   // OOXML: pt × 100
  const rPr = `<a:rPr lang="en-US" sz="${sz}" b="${t.bold ? 1 : 0}" i="${t.italic ? 1 : 0}" dirty="0">` +
    `<a:solidFill><a:srgbClr val="${hex6(t.color)}"/></a:solidFill>` +
    (t.font ? `<a:latin typeface="${esc(t.font)}"/>` : '') + `</a:rPr>`;
  const paras = t.text.split('\n').map(line => {
    const run = line ? `<a:r>${rPr}<a:t>${esc(line)}</a:t></a:r>` : `<a:endParaRPr sz="${sz}"/>`;
    return `<a:p><a:pPr algn="${t.align ?? 'l'}"/>${run}</a:p>`;
  }).join('');
  return `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${off(t.x)}" y="${off(t.y)}"/><a:ext cx="${off(t.w)}" cy="${off(t.h)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${t.valign ?? 't'}"/><a:lstStyle/>${paras}</p:txBody>` +
    `</p:sp>`;
}

function slideXml(cx: number, cy: number, name: string, texts: PptxText[] = []): string {
  const textShapes = texts.map((t, i) => textShapeXml(t, 10 + i)).join('');
  return XML + `<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">` +
    `<p:cSld><p:spTree>${EMPTY_TREE}` +
    `<p:pic>` +
    `<p:nvPicPr><p:cNvPr id="2" name="${esc(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `</p:pic>` +
    textShapes +
    `</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:sld>`;
}
function slideRels(i: number): string {
  return XML + `<Relationships xmlns="${PR}">` +
    `<Relationship Id="rId1" Type="${RT}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
    `<Relationship Id="rId2" Type="${RT}/image" Target="../media/image${i + 1}.png"/>` +
    `</Relationships>`;
}

/**
 * Assemble a .pptx (one full-bleed image slide per Folio page). Slide size is
 * taken from the first slide's pixel dimensions; every image is stretched to fill.
 */
export function buildPptx(slides: PptxSlide[], title = 'Folio Deck'): Buffer {
  if (!slides.length) throw new Error('buildPptx: no slides');
  const n = slides.length;
  const cx = Math.round(slides[0].width * EMU_PER_PX);
  const cy = Math.round(slides[0].height * EMU_PER_PX);
  const s = (x: string): Buffer => Buffer.from(x, 'utf8');

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: s(contentTypes(n)) },
    { name: '_rels/.rels', data: s(rootRels()) },
    { name: 'ppt/presentation.xml', data: s(presentation(n, cx, cy)) },
    { name: 'ppt/_rels/presentation.xml.rels', data: s(presentationRels(n)) },
    { name: 'ppt/presProps.xml', data: s(presProps()) },
    { name: 'ppt/theme/theme1.xml', data: s(theme()) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: s(slideMaster()) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: s(slideMasterRels()) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: s(slideLayout()) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: s(slideLayoutRels()) },
  ];
  slides.forEach((sl, i) => {
    entries.push({ name: `ppt/slides/slide${i + 1}.xml`, data: s(slideXml(cx, cy, `${title} ${i + 1}`, sl.texts)) });
    entries.push({ name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: s(slideRels(i)) });
    entries.push({ name: `ppt/media/image${i + 1}.png`, data: sl.png });
  });
  return zipStore(entries);
}
