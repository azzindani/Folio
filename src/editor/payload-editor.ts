import { StateManager, type EditorState } from './state';
import { parseDesign, serializeYAML } from '../schema/parser';
import { validateDesignSpec } from '../schema/validator';
import type { DesignSpec } from '../schema/types';

type MonacoEditor = import('monaco-editor').editor.IStandaloneCodeEditor;
type MonacoModule = typeof import('monaco-editor');

export class PayloadEditor {
  private container: HTMLElement;
  private state: StateManager;
  private editor: MonacoEditor | null = null;
  private monaco: MonacoModule | null = null;
  private isUpdatingFromState = false;
  private isUpdatingFromEditor = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private markers: import('monaco-editor').editor.IMarkerData[] = [];

  constructor(container: HTMLElement, state: StateManager) {
    this.container = container;
    this.state = state;
    this.state.subscribe(this.onStateChange.bind(this));
  }

  async init(): Promise<void> {
    this.monaco = await import('monaco-editor');

    // Configure YAML-like behavior (Monaco doesn't have native YAML mode,
    // but plaintext with custom highlights works)
    this.editor = this.monaco.editor.create(this.container, {
      value: this.state.get().yamlSource,
      language: 'yaml',
      theme: 'vs-dark',
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Fira Code, monospace',
      lineNumbers: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: 'on',
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      padding: { top: 8, bottom: 8 },
    });

    // Listen for changes in the editor
    this.editor.onDidChangeModelContent(() => {
      if (this.isUpdatingFromState) return;
      this.scheduleSync();
    });

    // Set initial content
    this.syncFromState();
  }

  private scheduleSync(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.syncToState(), 300);
  }

  private syncToState(): void {
    if (!this.editor || !this.monaco) return;

    const yamlSource = this.editor.getValue();
    this.isUpdatingFromEditor = true;

    try {
      const spec = parseDesign(yamlSource);
      const errors = validateDesignSpec(spec);

      // Update markers (inline error indicators)
      this.updateMarkers(errors);

      // Only update design if no critical errors
      const criticalErrors = errors.filter(e => e.severity === 'error');
      if (criticalErrors.length === 0) {
        this.state.batch(() => {
          this.state.set('yamlSource', yamlSource, false);
          this.state.set('design', spec);
          this.state.set('dirty', true, false);
        });
      } else {
        this.state.set('yamlSource', yamlSource, false);
      }
    } catch (err) {
      // Parse error — show inline in Monaco
      const parseErr = err as { line?: number; column?: number; message?: string };
      this.setParseErrorMarker(
        parseErr.line ?? 0,
        parseErr.column ?? 0,
        parseErr.message ?? 'YAML parse error',
      );
    }

    this.isUpdatingFromEditor = false;
  }

  private syncFromState(): void {
    if (!this.editor || this.isUpdatingFromEditor) return;

    const { design } = this.state.get();
    if (!design) return;

    this.isUpdatingFromState = true;
    const yaml = serializeYAML(design);
    const currentValue = this.editor.getValue();

    if (yaml !== currentValue) {
      // Preserve cursor position
      const position = this.editor.getPosition();
      this.editor.setValue(yaml);
      if (position) {
        this.editor.setPosition(position);
      }
    }

    this.isUpdatingFromState = false;
  }

  private updateMarkers(errors: { severity: string; path: string; message: string }[]): void {
    if (!this.monaco || !this.editor) return;

    this.markers = errors.map(err => ({
      severity: err.severity === 'error'
        ? this.monaco!.MarkerSeverity.Error
        : this.monaco!.MarkerSeverity.Warning,
      message: `${err.path}: ${err.message}`,
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    }));

    const model = this.editor.getModel();
    if (model) {
      this.monaco.editor.setModelMarkers(model, 'design-validator', this.markers);
    }
  }

  private setParseErrorMarker(line: number, column: number, message: string): void {
    if (!this.monaco || !this.editor) return;

    const model = this.editor.getModel();
    if (model) {
      this.monaco.editor.setModelMarkers(model, 'design-validator', [{
        severity: this.monaco.MarkerSeverity.Error,
        message,
        startLineNumber: Math.max(1, line + 1),
        startColumn: Math.max(1, column + 1),
        endLineNumber: Math.max(1, line + 1),
        endColumn: Math.max(1, column + 2),
      }]);
    }
  }

  private onStateChange(state: EditorState, changedKeys: (keyof EditorState)[]): void {
    if (changedKeys.includes('design') && !this.isUpdatingFromEditor) {
      this.syncFromState();
    }

    if (changedKeys.includes('mode')) {
      this.container.style.display = state.mode === 'payload' ? 'block' : 'none';
      if (state.mode === 'payload' && this.editor) {
        this.editor.layout();
      }
    }
  }

  show(): void {
    this.container.style.display = 'block';
    this.editor?.layout();
    this.syncFromState();
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  dispose(): void {
    this.editor?.dispose();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  getErrors(): typeof this.markers {
    return this.markers;
  }
}
