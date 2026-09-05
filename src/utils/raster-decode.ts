// Decode JPEG / WebP / GIF into the RGBA buffer the pixel pipeline works on.
//
// docs/MOTION.md §5 listed "JPEG/WebP decode" as open, and asset_process
// refused anything but PNG — correctly, since returning the file untouched
// would look like the work had happened. But refusing is not the goal; the
// point was never to write a JPEG decoder, it was to let a model crop and
// adjust the photo it actually has, and photos are JPEGs.
//
// No new dependency. resvg is already here for every raster export, and it
// decodes embedded images: wrap the bytes in a one-element SVG at the image's
// native size and render it. The result comes back as PNG, which the existing
// hand-written codec already reads. One code path, no format-specific decoders
// to maintain, and it is the same library that will rasterise the design later
// — so what the pipeline sees is what the export will see.
//
// Output is always RGBA; the pipeline stores PNG regardless, which is the
// documented behaviour of asset_process ("store the result as a NEW png").
import { Resvg } from '@resvg/resvg-js';
import { decodePNG, isPNG, type RasterImage } from './png-codec';
import { parseDimensions } from '../mcp/engine/reference';

export class DecodeError extends Error {
  constructor(message: string, public hint: string) { super(message); }
}

export type RasterFormat = 'png' | 'jpeg' | 'webp' | 'gif';

/** Format from the BYTES, never the filename — a PNG saved as .jpg is common. */
export function sniffRaster(buf: Buffer): RasterFormat | null {
  if (isPNG(buf)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return null;
}

const MIME: Record<RasterFormat, string> = {
  png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

/**
 * Any supported raster → RGBA.
 *
 * PNG goes straight through the existing codec: it is lossless either way, and
 * routing it through a renderer would be slower and would drop nothing useful
 * but gain nothing either.
 */
export function decodeRaster(buf: Buffer): RasterImage {
  const fmt = sniffRaster(buf);
  if (!fmt) {
    throw new DecodeError(
      'Not a recognisable image: the bytes are not PNG, JPEG, WebP or GIF.',
      'Check the file actually contains an image — an HTML error page saved as .jpg looks like this.',
    );
  }
  if (fmt === 'png') return decodePNG(buf);

  const dims = parseDimensions(buf);
  if (!dims || dims.w <= 0 || dims.h <= 0) {
    throw new DecodeError(
      `Could not read the size of this ${fmt.toUpperCase()}.`,
      'The header is truncated or unusual. Re-save the image and try again.',
    );
  }
  // Render at NATIVE size: anything else silently resamples, and a caller
  // asking to crop 40px expects those to be the image's own pixels.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dims.w}" height="${dims.h}">`
    + `<image href="data:${MIME[fmt]};base64,${buf.toString('base64')}" x="0" y="0" width="${dims.w}" height="${dims.h}"/></svg>`;
  let png: Buffer;
  try {
    png = Buffer.from(new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng());
  } catch (e) {
    throw new DecodeError(
      `This ${fmt.toUpperCase()} could not be decoded: ${(e as Error).message}`,
      fmt === 'webp'
        ? 'Animated or lossless-alpha WebP is the usual cause. Re-save it as PNG or JPEG.'
        : 'The file may be progressive, CMYK or truncated. Re-save it as a baseline RGB image.',
    );
  }
  return decodePNG(png);
}
