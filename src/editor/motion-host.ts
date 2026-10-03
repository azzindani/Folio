// The editor's one motion player, reachable from panels that are built before — or without — the timeline.
//
// The Clip inspector needs the playhead (where "add a key here" lands, where a freeze starts) and the
// rows' clocks, but it is constructed with the properties panel, which holds no player. The player
// registers itself here when it is made; the newest wins (an editor has exactly one).

import type { MotionPlayer } from './motion-player';

let current: MotionPlayer | null = null;

export function registerMotionPlayer(p: MotionPlayer): void { current = p; }

/** The editor's motion player; null before it exists. */
export function motionHost(): MotionPlayer | null { return current; }
