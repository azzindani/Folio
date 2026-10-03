// The open design's place on the Folio server — what an editor action that asks the SERVER to do something
// to the design needs: where the file is, and a way to make the file match what is on screen.
//
// Registered by the toolbar (which is built with the app); panels that are not handed the app read it here.

export interface ServerHost {
  /** The design's path inside the projects folder, or null when it has no server file yet. */
  rel(): string | null;
  /** Write the design to its server file; false when that did not happen. */
  save(): Promise<boolean>;
}

let current: ServerHost | null = null;

export function registerServerHost(h: ServerHost): void { current = h; }

export function serverHost(): ServerHost | null { return current; }
