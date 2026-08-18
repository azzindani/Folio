// Folio editor — the LOCAL folder picker in the Files panel.
//
// Distinct from the asset manager (ui/panels/asset-panel.ts): that one is a
// file manager over the project's own store on the server, reachable from any
// device. This one reaches into a directory on THIS machine through the File
// System Access API, so a designer can pull straight from a working folder
// without uploading anything first.
//
// Split out of app-base.ts, which was at its 700-line ceiling.
import { projectFolder } from '../fs/project-folder';
import { chromeIcon } from './chrome-icons';
import type { ImageImportHandler } from './image-import-handler';

/**
 * Wire the "open folder" button and the thumbnail grid beside it.
 *
 * No-op when the markup is absent, so a stripped-down editor shell that omits
 * the Files panel does not have to know this exists.
 */
export function wireLocalFolderPanel(container: HTMLElement, imageImport: ImageImportHandler): void {
  const btn = container.querySelector<HTMLElement>('#open-folder-btn');
  const grid = container.querySelector<HTMLElement>('#asset-grid');
  if (!btn || !grid) return;

  btn.addEventListener('click', async () => {
    try {
      await projectFolder.open();
      btn.innerHTML = chromeIcon('folder', 13);
      btn.appendChild(document.createTextNode(` ${projectFolder.rootName}`));
    } catch (err) {
      const { showToast } = await import('../utils/toast');
      showToast((err as Error).message, 'warning');
    }
  });

  const renderGrid = async (): Promise<void> => {
    const assets = projectFolder.getAssets();
    if (assets.length === 0) {
      grid.innerHTML = '<span class="asset-empty">No images found</span>';
      return;
    }
    grid.innerHTML = '';
    for (const entry of assets) {
      const tile = document.createElement('div');
      tile.className = 'asset-tile';
      tile.title = entry.path;
      const url = await projectFolder.getBlobUrl(entry);
      tile.style.backgroundImage = `url(${url})`;
      tile.addEventListener('click', async () => {
        const file = await entry.handle.getFile();
        // SVG keeps its markup (and stays editable); anything else is imported
        // as a raster.
        if (entry.name.endsWith('.svg')) await imageImport.fromSVGFile(file);
        else await imageImport.fromRaster(file);
      });
      grid.appendChild(tile);
    }
  };

  projectFolder.onChange(() => { void renderGrid(); });
}
