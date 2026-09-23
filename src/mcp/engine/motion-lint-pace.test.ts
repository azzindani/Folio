import { describe, it, expect } from 'vitest';
import { crowdNotes, restlessNotes, readingLines, type ReadLine, type Shown } from './motion-lint-pace';

const line = (id: string, settle: number, words = 5, entered = true): ReadLine => ({ id, words, settle, x: 0, y: 0, entered });
const shown = (id: string, text: string, settle: number, x: number, block = id): Shown => ({ id, text, block, settle, x, y: 100, entered: true });

describe('crowdNotes — lines landing together', () => {
  it('flags three sentences in the same instant, and not a stagger', () => {
    expect(crowdNotes([{ shot: 's', lines: [line('a', 400), line('b', 400), line('c', 430)] }]).map(n => n.layers)).toEqual([['a', 'b', 'c']]);
    expect(crowdNotes([{ shot: 's', lines: [line('a', 400), line('b', 480), line('c', 560)] }])).toEqual([]);
  });

  it('counts sentences this shot brought in, not labels or words already on the opening frame', () => {
    expect(crowdNotes([{ shot: 's', lines: [line('a', 400), line('b', 400), line('c', 400, 2)] }])).toEqual([]);
    expect(crowdNotes([{ shot: 's', lines: [line('a', 0, 5, false), line('b', 0, 5, false), line('c', 0, 5, false)] }])).toEqual([]);
  });
});

describe('readingLines — what a viewer reads', () => {
  it('reads a letter-split title as one line, landed when its last letter lands', () => {
    const letters = [...'SMALLMACHINES'].map((c, i) => shown(`t_c${i + 1}`, c, 100 * i, 60 * i, 't'));
    expect(readingLines(letters)).toEqual([{ id: 't', words: 3, settle: 1200, x: 0, y: 100, entered: true }]);
  });

  it('reads word pieces as their words, and an echo of words already read not again', () => {
    const pieces = ['Ship', 'it', 'now'].map((w, i) => shown(`h_w${i + 1}`, w, 200 + 80 * i, 100 * i, 'h'));
    const ghost = shown('ghost', 'Ship it   now', 0, 4);
    expect(readingLines([...pieces, ghost]).map(l => [l.id, l.words])).toEqual([['ghost', 3]]);
    expect(readingLines([...pieces, shown('other', 'Ship it', 0, 4)]).map(l => [l.id, l.words])).toEqual([['other', 2], ['h', 3]]);
  });
});

describe('restlessNotes — no rest for the eye', () => {
  it('flags seconds of motion with every gap under a second, and not a piece that pauses', () => {
    const busy = [0, 900, 1800, 2700, 3600].map(s => ({ start: s, end: s + 800 }));
    expect(restlessNotes(busy).map(n => n.at_ms)).toEqual([0]);
    const paused = [{ start: 0, end: 2500 }, { start: 3600, end: 6000 }];
    expect(restlessNotes(paused)).toEqual([]);
  });
});
