import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileTreeManager } from './file-tree';
import { StateManager } from '../../editor/state';
import { saveFile } from '../../fs/file-access';
import type { DesignSpec } from '../../schema/types';

// ── Module mocks ─────────────────────────────────────────────

vi.mock('../../fs/file-access', () => ({
  openFile: vi.fn().mockRejectedValue(new Error('cancelled')),
  saveFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/toast', () => ({
  showToast: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function makeDesign(name = 'Test Design'): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'test-id', name, type: 'poster', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    layers: [],
  } as unknown as DesignSpec;
}

function makeCallbacks(onSaveYaml = 'yaml: content') {
  return {
    onOpen: vi.fn(),
    onSave: vi.fn().mockReturnValue(onSaveYaml),
  };
}

const RECENT_KEY = 'folio:recentFiles';

// ── Tests ────────────────────────────────────────────────────

describe('FileTreeManager', () => {
  let state: StateManager;
  let container: HTMLElement;
  let callbacks: ReturnType<typeof makeCallbacks>;

  beforeEach(() => {
    state = new StateManager();
    container = makeContainer();
    callbacks = makeCallbacks();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    container.remove();
    localStorage.clear();
  });

  // ── Structure ────────────────────────────────────────────

  it('builds .filetree-current element', () => {
    new FileTreeManager(container, state, callbacks);
    expect(container.querySelector('.filetree-current')).not.toBeNull();
  });

  it('builds .filetree-recent element', () => {
    new FileTreeManager(container, state, callbacks);
    expect(container.querySelector('.filetree-recent')).not.toBeNull();
  });

  it('has Open button', () => {
    new FileTreeManager(container, state, callbacks);
    const btns = [...container.querySelectorAll('button')];
    const openBtn = btns.find(b => b.textContent === 'Open');
    expect(openBtn).not.toBeUndefined();
  });

  it('has Save button', () => {
    new FileTreeManager(container, state, callbacks);
    const btns = [...container.querySelectorAll('button')];
    const saveBtn = btns.find(b => b.textContent === 'Save');
    expect(saveBtn).not.toBeUndefined();
  });

  // ── refreshCurrent: no design ────────────────────────────

  it('shows "No file open" when design is null', () => {
    new FileTreeManager(container, state, callbacks);
    const current = container.querySelector('.filetree-current');
    expect(current?.textContent).toContain('No file open');
  });

  // ── refreshCurrent: with design ─────────────────────────

  it('shows design name when design is set', () => {
    new FileTreeManager(container, state, callbacks);
    state.set('design', makeDesign('My Poster'));
    const current = container.querySelector('.filetree-current');
    expect(current?.innerHTML).toContain('My Poster');
  });

  it('shows dirty indicator (●) when dirty is true', () => {
    new FileTreeManager(container, state, callbacks);
    state.set('design', makeDesign('Draft'));
    state.set('dirty', true, false);
    const current = container.querySelector('.filetree-current');
    // jsdom renders &#x25CF; as the actual ● character in innerHTML
    expect(current?.innerHTML).toContain('●');
  });

  it('does not show dirty indicator when dirty is false', () => {
    new FileTreeManager(container, state, callbacks);
    state.set('design', makeDesign('Clean'));
    state.set('dirty', false, false);
    const current = container.querySelector('.filetree-current');
    expect(current?.innerHTML).not.toContain('●');
  });

  // ── triggerSave ──────────────────────────────────────────

  it('triggerSave calls onSave callback', () => {
    const ft = new FileTreeManager(container, state, callbacks);
    state.set('design', makeDesign('My Design'));
    ft.triggerSave();
    expect(callbacks.onSave).toHaveBeenCalledOnce();
  });

  it('triggerSave calls saveFile with yaml and filename', () => {
    const ft = new FileTreeManager(container, state, callbacks);
    state.set('design', makeDesign('My Design'));
    ft.triggerSave();
    expect(saveFile).toHaveBeenCalledWith('yaml: content', 'my-design.design.yaml');
  });

  it('triggerSave uses "design" as fallback name when design is null', () => {
    const ft = new FileTreeManager(container, state, callbacks);
    ft.triggerSave();
    expect(saveFile).toHaveBeenCalledWith('yaml: content', 'design.design.yaml');
  });

  it('clicking Save button calls triggerSave', () => {
    const ft = new FileTreeManager(container, state, callbacks);
    const spy = vi.spyOn(ft, 'triggerSave');
    const btns = [...container.querySelectorAll('button')];
    const saveBtn = btns.find(b => b.textContent === 'Save') as HTMLButtonElement;
    saveBtn.click();
    expect(spy).toHaveBeenCalledOnce();
  });

  // ── refreshRecent ────────────────────────────────────────

  it('shows "None" when localStorage is empty', () => {
    new FileTreeManager(container, state, callbacks);
    const recent = container.querySelector('.filetree-recent');
    expect(recent?.textContent).toContain('None');
  });

  it('shows recent file items when localStorage has entries', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['design-a.yaml', 'design-b.yaml']));
    new FileTreeManager(container, state, callbacks);
    const recent = container.querySelector('.filetree-recent');
    expect(recent?.innerHTML).toContain('design-a.yaml');
    expect(recent?.innerHTML).toContain('design-b.yaml');
  });

  it('shows all recent file names as clickable items', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['alpha.yaml', 'beta.yaml', 'gamma.yaml']));
    new FileTreeManager(container, state, callbacks);
    const items = container.querySelectorAll('.filetree-recent-item');
    expect(items.length).toBe(3);
  });

  it('recent items contain file name text', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['my-file.yaml']));
    new FileTreeManager(container, state, callbacks);
    const item = container.querySelector('.filetree-recent-item') as HTMLElement;
    expect(item.textContent).toContain('my-file.yaml');
  });

  // ── State subscription ───────────────────────────────────

  it('state design change triggers refreshCurrent', () => {
    new FileTreeManager(container, state, callbacks);
    // Initially shows "No file open"
    const current = container.querySelector('.filetree-current');
    expect(current?.textContent).toContain('No file open');

    // After setting design, shows design name
    state.set('design', makeDesign('New Design'));
    expect(current?.innerHTML).toContain('New Design');
  });

  it('state dirty change triggers refreshCurrent', () => {
    new FileTreeManager(container, state, callbacks);
    state.set('design', makeDesign('Test'));
    // Initially not dirty
    const current = container.querySelector('.filetree-current');
    expect(current?.innerHTML).not.toContain('●');

    // Set dirty
    state.set('dirty', true, false);
    expect(current?.innerHTML).toContain('●');
  });

  it('state changes unrelated to design/dirty do not affect .filetree-current', () => {
    new FileTreeManager(container, state, callbacks);
    state.set('design', makeDesign('Static'));
    const html1 = container.querySelector('.filetree-current')?.innerHTML;

    // Change an unrelated key
    state.set('zoom', 2, false);
    const html2 = container.querySelector('.filetree-current')?.innerHTML;
    expect(html1).toBe(html2);
  });

  // ── triggerOpen ──────────────────────────────────────────

  it('triggerOpen does not throw when openFile rejects (user cancelled)', async () => {
    const ft = new FileTreeManager(container, state, callbacks);
    await expect(ft.triggerOpen()).resolves.toBeUndefined();
  });

  it('clicking Open button does not throw', () => {
    new FileTreeManager(container, state, callbacks);
    const btns = [...container.querySelectorAll('button')];
    const openBtn = btns.find(b => b.textContent === 'Open') as HTMLButtonElement;
    expect(() => openBtn.click()).not.toThrow();
  });

  it('triggerOpen calls onOpen with file content when openFile resolves', async () => {
    const { openFile } = await import('../../fs/file-access');
    vi.mocked(openFile).mockResolvedValueOnce({
      content: 'yaml content',
      name: 'test.yaml',
      handle: null as unknown as FileSystemFileHandle,
    });
    const onOpen = vi.fn();
    const ft = new FileTreeManager(container, state, { ...callbacks, onOpen });
    await ft.triggerOpen();
    expect(onOpen).toHaveBeenCalledWith('yaml content', 'test.yaml', null);
  });

  it('triggerSave shows error toast when saveFile rejects', async () => {
    const { showToast } = await import('../../utils/toast');
    vi.mocked(saveFile).mockRejectedValueOnce(new Error('Write failed'));
    const ft = new FileTreeManager(container, state, callbacks);
    ft.triggerSave();
    await new Promise(r => setTimeout(r, 20));
    expect(showToast).toHaveBeenCalledWith('Write failed', 'error');
  });
});
