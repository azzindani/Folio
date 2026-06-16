// Folio Catalog — shared HTML-escaping helpers (escapeHTML / escapeAttr),
// used by both the catalog base class and the dialog orchestration.

export function escapeHTML(s: string | number | null | undefined): string {
  // Defensive coercion: YAML parsing can yield numeric tags (e.g. an
  // unquoted `404` tag becomes Number 404), and calling .replace on a
  // non-string throws TypeError. Coerce to string so any catalog entry
  // with a numeric tag still renders instead of breaking the whole tab.
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(s: string): string {
  return escapeHTML(s);
}
