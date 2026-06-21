// Folio renderer — layer renderers facade. Implementations are split by family
// into sibling modules to stay within the line budget; this re-exports the same
// public surface so importers are unchanged.
export { renderRect, renderCircle, renderPath, renderPolygon, renderLine, renderText, renderImage, renderIcon } from './layer-renderers-shapes';
export { renderConnector } from './layer-renderers-connector';
export { renderMermaid, renderChart, renderCode, renderMath, renderInteractiveChart, buildChartPreviewSpec, renderInteractiveTable, renderRichText, renderKpiCard, renderMap, renderEmbedCode } from './layer-renderers-embed';
export { renderGroup, renderQRCode, renderAutoLayout, renderPopup, renderParticle, renderButton, renderToggle, renderCallout, renderProgress, renderTooltip, renderFilterBar, renderTabs, renderAccordion } from './layer-renderers-layout';
