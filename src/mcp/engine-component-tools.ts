// Folio MCP engine — reusable components: save one, and FIND one.
//
// Components have existed all along — a .component.yaml store, an index, a
// registry the renderer consults, `{{prop}}` substitution, variants. Across 267
// stored designs, ZERO component files exist. The reason is the same one that
// made the template catalog a dead op: there was no way to LIST them. A model
// that saved a component in one session could not discover it in the next, so
// nothing was ever built on top of one, so nothing was ever saved.
//
// Two changes:
//   templates {op:"components"}  — the missing half: what does this project have?
//   save_component auto-slots    — every text layer becomes a named {{slot}} with
//                                  its current copy as the default.
//
// The second matters more than it looks. save_component used to write
// `props: {}` — a component with no props is a frozen snapshot, identical every
// time it is placed, which is a copy-paste with extra steps. Slots are what make
// it a COMPONENT: one saved "stat card", ten instances, ten different numbers.
// That is the Code-Connect idea the review points at — a named part with typed
// holes, not a picture of one.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer, ComponentSpec } from '../schema/types';
import type { ToolResult, ProgressItem, NextAction } from './types';

import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pInfo, buildContext, buildHandover } from './engine/utils';

interface IndexEntry { id: string; path: string; name: string }
interface ComponentIndex { components?: IndexEntry[] }

/** Text content of a layer, however it is written. */
function layerText(l: Layer): string {
  const c = (l as unknown as Record<string, unknown>)['content'];
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object') return String((c as Record<string, unknown>)['value'] ?? '');
  return '';
}

/** A readable slot name from a layer id: "stat_1_title" → "title", deduped. */
function slotName(layerId: string, taken: Set<string>): string {
  const tail = layerId.split(/[_-]/).filter(Boolean).pop() ?? 'text';
  let name = tail.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'text';
  if (/^\d+$/.test(name)) name = `text${name}`;
  let out = name;
  for (let n = 2; taken.has(out); n++) out = `${name}${n}`;
  taken.add(out);
  return out;
}

/** Turn every text layer into a {{slot}} with its current copy as the default,
 *  so the saved part can be re-used with different content. Mutates `layers`. */
export function autoSlots(layers: Layer[]): Record<string, { type: 'text'; default: string }> {
  const props: Record<string, { type: 'text'; default: string }> = {};
  const taken = new Set<string>();
  const walk = (ls: Layer[]): void => {
    for (const l of ls) {
      const o = l as unknown as Record<string, unknown>;
      if (o['type'] === 'text') {
        const value = layerText(l).trim();
        // Already parameterised, or nothing to parameterise.
        if (value && !value.includes('{{')) {
          const name = slotName(String(o['id'] ?? 'text'), taken);
          props[name] = { type: 'text', default: value };
          const c = o['content'];
          if (typeof c === 'string') o['content'] = `{{${name}}}`;
          else if (c && typeof c === 'object') (c as Record<string, unknown>)['value'] = `{{${name}}}`;
        }
      }
      const kids = o['layers'];
      if (Array.isArray(kids)) walk(kids as Layer[]);
    }
  };
  walk(layers);
  return props;
}

// ── save_component ──────────────────────────────────────────

export function saveAsComponent(args: {
  design_path: string; layer_ids: string[]; component_name: string; project_path: string;
  auto_slots?: boolean;
}): ToolResult {
  const op = 'save_as_component';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  const extracted = (spec.layers ?? []).filter(l => args.layer_ids.includes(l.id));
  if (extracted.length === 0) return errResult(op, `No matching layers for IDs: ${args.layer_ids.join(', ')}`, 'Use manage_design {op:"inspect"} to get layer IDs.', progress);

  const componentId = args.component_name.toLowerCase().replace(/\s+/g, '-');
  const componentPath = path.join(args.project_path, `components/${componentId}.component.yaml`);
  // Work on a COPY: auto-slotting rewrites text into {{placeholders}}, and the
  // design keeps its real copy (the instance re-renders it from the defaults).
  const componentLayers = JSON.parse(JSON.stringify(extracted)) as Layer[];
  const props = args.auto_slots === false ? {} : autoSlots(componentLayers);
  writeYAML(componentPath, { _protocol: 'component/v1', name: args.component_name, id: componentId, version: '1.0.0', props, layers: componentLayers });
  const slotNames = Object.keys(props);
  progress.push(pOk(`Wrote component "${args.component_name}"`, `${path.basename(componentPath)}${slotNames.length ? ` · slots: ${slotNames.join(', ')}` : ' · no text slots'}`));

  const indexPath = path.join(args.project_path, 'components/index.yaml');
  const index = fs.existsSync(indexPath) ? readYAML<ComponentIndex>(indexPath) : { components: [] };
  index.components = (index.components ?? []).filter(c => c.id !== componentId);
  index.components.push({ id: componentId, path: `components/${componentId}.component.yaml`, name: args.component_name });
  writeYAML(indexPath, index);

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const firstLayer = extracted[0];
  const instance = { id: `${componentId}-instance`, type: 'component', z: firstLayer.z, x: firstLayer.x ?? 0, y: firstLayer.y ?? 0, width: firstLayer.width ?? 0, height: firstLayer.height ?? 0, ref: componentId, slots: {} } as unknown as Layer;
  spec.layers = [...(spec.layers ?? []).filter(l => !args.layer_ids.includes(l.id)), instance].sort((a, b) => a.z - b.z);
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Replaced ${extracted.length} layer(s) with component instance`));

  const context = buildContext(op, `Extracted ${extracted.length} layer(s) into component "${args.component_name}"`, [
    { type: 'component', path: componentPath, role: 'created' },
    { type: 'design', path: dPath, role: 'updated' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath, project_path: args.project_path });
  const next_action: NextAction = {
    tool: 'add_layers',
    params: { design_path: dPath, layers_shorthand: [{ type: 'component', ref: componentId, pos: [0, 0, instance['width'] ?? 400, instance['height'] ?? 200], slots: Object.fromEntries(slotNames.map(n => [n, props[n].default])) }] },
    remaining: -1,
    hint: slotNames.length
      ? `Place it again with different copy: pass slots:{${slotNames.slice(0, 3).join(', ')}}. Omitted slots fall back to the saved defaults.`
      : 'Place it again with {type:"component", ref, pos}. It has no text slots, so every instance is identical.',
  };
  return okResult(op, {
    component_id: componentId, component_path: componentPath,
    layers_extracted: extracted.length, instance_id: instance['id'],
    slots: props, slot_names: slotNames,
    progress, context, handover, next_action,
  }, bak);
}

// ── list components ─────────────────────────────────────────

/** What a project can compose FROM. Without this the store is write-only. */
export function listComponents(args: { project_path: string }): ToolResult {
  const op = 'list_components';
  const progress: ProgressItem[] = [];
  const pDir = path.resolve(args.project_path);
  const indexPath = path.join(pDir, 'components/index.yaml');
  const rows: { id: string; name: string; slots: string[]; variants: string[]; layers: number }[] = [];
  if (fs.existsSync(indexPath)) {
    const index = readYAML<ComponentIndex>(indexPath);
    for (const entry of index.components ?? []) {
      const cPath = path.join(pDir, entry.path);
      if (!fs.existsSync(cPath)) continue;
      try {
        const c = readYAML<ComponentSpec>(cPath);
        rows.push({
          id: entry.id, name: c.name ?? entry.name,
          slots: Object.keys(c.props ?? {}),
          variants: (c.variants ?? []).map(v => v.name),
          layers: (c.layers ?? []).length,
        });
      } catch { /* a broken component file must not hide the working ones */ }
    }
  }

  // create_project scaffolds an EMPTY index, so "no file" and "empty file" are
  // the same situation to a caller and must give the same answer — an empty list
  // with no explanation reads as a broken tool.
  if (rows.length === 0) {
    return okResult(op, {
      components: [], count: 0,
      note: 'This project has saved no components. Build a part once, then templates {op:"save_component", design_path, layer_ids, component_name} turns it into a reusable one — every text layer becomes a named slot, so the next instance can carry different copy.',
      progress, context: buildContext(op, 'No components in this project'),
    });
  }

  progress.push(pOk(`${rows.length} component(s)`, rows.map(r => r.id).join(', ')));
  const first = rows[0];
  return okResult(op, {
    components: rows, count: rows.length,
    usage: 'Place one with {type:"component", ref:"<id>", pos:[x,y,w,h], slots:{…}} in layers_shorthand. Slots you omit fall back to the component\'s saved defaults.',
    ...(first ? { next_action: { tool: 'add_layers', params: { layers_shorthand: [{ type: 'component', ref: first.id, pos: [0, 0, 400, 200], slots: {} }] }, remaining: -1, hint: `Place "${first.id}"${first.slots.length ? `; its slots are ${first.slots.join(', ')}` : ''}.` } as NextAction } : {}),
    progress, context: buildContext(op, `${rows.length} component(s) in ${path.basename(pDir)}`),
  });
}
