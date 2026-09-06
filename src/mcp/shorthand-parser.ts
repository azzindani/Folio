// Folio shorthand parser — facade. Implementation split by family into sibling
// modules to stay within the line budget; this preserves the public surface.
export { SHAPE_NAMES, estTextHeight } from './shorthand-helpers';
export type { ShorthandLayer } from './shorthand-helpers';
export { expandShorthand, coerceShorthandLayers, expandShorthandLayers } from './shorthand-expand';
export { coerceLayerArray } from './shorthand-coerce';
export { hasPresetType, recoverStringifiedPreset, unwrapBareContainers, fillBleedPresetDims, fillFlowPresetsToPage, snapWrongFlowPresets, demoteCoveringBackdrops, lockCarouselCanvas, stampDeckSeed } from './shorthand-recover';
export { diagnoseShorthandKeys, detectTextOverlap, diagnoseLayers, compressDesignContext } from './shorthand-diagnose';
