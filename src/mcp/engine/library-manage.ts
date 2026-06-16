// Design Library — management ops (the "manager" half of the file-manager).
// browse_library/export_library_gallery let you SEE the collection; these let you
// organise it: rename, delete (to a recoverable .trash, never a hard unlink), and
// move a design between projects. All mutate a single .design.yaml or its location
// and write back through the same readYAML/writeYAML round-trip the rest of the
// engine uses. Pure filesystem + YAML — no rendering.

import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec } from '../../schema/types';
import type { ToolResult } from '../types';
import { okResult, errResult, buildContext, pOk, pInfo, readYAML, writeYAML, resolveDesignPath, resolveProjectPath } from './utils';
import { buildEditorLink } from './editor-link';

const SUFFIX = '.design.yaml';

/** Rename a design's DISPLAY name (meta.name). The file path is left stable on
 *  purpose so existing editor links / references never break. */
export function renameDesign(args: { design_path: string; new_name: string; project_path?: string }): ToolResult {
  const op = 'rename_design';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const name = String(args.new_name ?? '').trim();
  if (!name) return errResult(op, 'new_name is empty', 'Pass a non-empty new_name.');
  let spec: DesignSpec;
  try { spec = readYAML<DesignSpec>(dPath); } catch (e) { return errResult(op, `Could not read design: ${(e as Error).message}`, 'The file may be malformed.'); }
  const old = spec.meta?.name ?? '';
  spec.meta = { ...spec.meta, name, modified: new Date().toISOString() };
  writeYAML(dPath, spec);
  const progress = [pOk(`Renamed "${old}" → "${name}"`, dPath)];
  const context = buildContext(op, `Renamed design to "${name}"`, [{ type: 'design', path: dPath, role: 'updated' }]);
  return okResult(op, { design_path: dPath, name, previous_name: old, progress, context });
}

/** Soft-delete: move the design into <project>/.trash/ (recoverable), never unlink. */
export function deleteDesign(args: { design_path: string; project_path?: string }): ToolResult {
  const op = 'delete_design';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const projDir = path.dirname(path.dirname(dPath));   // <project>/designs/<file> → <project>
  const trashDir = path.join(projDir, '.trash');
  try { fs.mkdirSync(trashDir, { recursive: true }); } catch (e) { return errResult(op, `Could not create trash: ${(e as Error).message}`, 'Check the project is writable.'); }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(trashDir, `${stamp}__${path.basename(dPath)}`);
  try { fs.renameSync(dPath, dest); } catch (e) { return errResult(op, `Could not move to trash: ${(e as Error).message}`, 'Check filesystem permissions.'); }
  const progress = [pOk(`Moved design to trash`, dest), pInfo('Recoverable', 'rename it back out of .trash/ to restore')];
  const context = buildContext(op, `Deleted (to trash) "${path.basename(dPath)}"`, [{ type: 'design', path: dest, role: 'trashed' }]);
  return okResult(op, { trashed_path: dest, original_path: dPath, progress, context });
}

/** Move a design's file into another project's designs/ dir. */
export function moveDesign(args: { design_path: string; target_project: string; project_path?: string }): ToolResult {
  const op = 'move_design';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  if (!args.target_project) return errResult(op, 'target_project is required', 'Pass the destination project (bare name or path).');
  const targetDir = resolveProjectPath(args.target_project);
  if (!fs.existsSync(path.join(targetDir, 'project.yaml'))) return errResult(op, `Target project not found: ${targetDir}`, 'Create it first with create_project, or check the name.');
  const destDesigns = path.join(targetDir, 'designs');
  try { fs.mkdirSync(destDesigns, { recursive: true }); } catch (e) { return errResult(op, `Could not prepare target: ${(e as Error).message}`, 'Check the target project is writable.'); }
  let dest = path.join(destDesigns, path.basename(dPath));
  if (fs.existsSync(dest) && dest !== dPath) {           // name collision → suffix
    dest = path.join(destDesigns, path.basename(dPath).replace(SUFFIX, '') + `-${Date.now().toString(36)}` + SUFFIX);
  }
  if (dest === dPath) return errResult(op, 'Design is already in the target project', 'Nothing to move.');
  try { fs.renameSync(dPath, dest); } catch (e) { return errResult(op, `Could not move design: ${(e as Error).message}`, 'Moving across filesystems may need a copy; check permissions.'); }
  const link = buildEditorLink(dest);
  const progress = [pOk(`Moved design to ${path.basename(targetDir)}`, dest)];
  const context = buildContext(op, `Moved "${path.basename(dPath)}" → ${path.basename(targetDir)}`, [{ type: 'design', path: dest, role: 'moved' }]);
  return okResult(op, { design_path: dest, original_path: dPath, target_project: targetDir, open_url: link.open_url, progress, context });
}
