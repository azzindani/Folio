/** Whether any page of a design holds a video layer. */
export function hasVideoLayer(d: { layers?: unknown[]; pages?: Array<{ layers?: unknown[] }> } | null | undefined): boolean {
  const any = (ls: unknown[] | undefined): boolean => (ls ?? []).some(l => {
    const o = l as { type?: string; layers?: unknown[] };
    return o.type === 'video' || any(o.layers);
  });
  return any(d?.layers) || (d?.pages ?? []).some(p => any(p.layers));
}
