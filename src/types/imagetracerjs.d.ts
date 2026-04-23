declare module 'imagetracerjs' {
  interface TracerOptions {
    ltres?: number; qtres?: number; pathomit?: number;
    rightangleenhance?: boolean; colorsampling?: number;
    numberofcolors?: number; mincolorratio?: number;
    colorquantcycles?: number; layering?: number;
    strokewidth?: number; linefilter?: boolean;
    scale?: number; roundcoords?: number;
    viewbox?: boolean; desc?: boolean;
  }
  const ImageTracer: {
    imagedataToSVG(imageData: ImageData, options?: TracerOptions): string;
    imageToSVG(url: string, callback: (svgStr: string) => void, options?: TracerOptions): void;
  };
  export default ImageTracer;
}
