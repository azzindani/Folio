import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { readBodyCapped, PayloadTooLargeError } from './http-body';
import type { IncomingMessage } from 'http';

// Minimal fake IncomingMessage: an EventEmitter is enough — readBodyCapped
// only consumes 'data' / 'end' / 'error'.
function fakeReq(): IncomingMessage {
  return new EventEmitter() as unknown as IncomingMessage;
}

describe('readBodyCapped', () => {
  it('resolves the full body when under the cap', async () => {
    const req = fakeReq();
    const p = readBodyCapped(req, 1024);
    req.emit('data', Buffer.from('hello '));
    req.emit('data', Buffer.from('world'));
    req.emit('end');
    expect(await p).toBe('hello world');
  });

  it('rejects with PayloadTooLargeError past the cap', async () => {
    const req = fakeReq();
    const p = readBodyCapped(req, 8);
    req.emit('data', Buffer.from('0123456789')); // 10 bytes > 8
    await expect(p).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('aborts only once and ignores chunks after the cap is hit', async () => {
    const req = fakeReq();
    const p = readBodyCapped(req, 4);
    req.emit('data', Buffer.from('aaaaa')); // trips
    req.emit('data', Buffer.from('bbbbb')); // ignored, must not throw
    req.emit('end');                         // ignored
    await expect(p).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('exposes the configured limit on the error', async () => {
    const req = fakeReq();
    const p = readBodyCapped(req, 3);
    req.emit('data', Buffer.from('xxxx'));
    await expect(p).rejects.toMatchObject({ limit: 3 });
  });

  it('propagates stream errors before the cap', async () => {
    const req = fakeReq();
    const p = readBodyCapped(req, 1024);
    req.emit('error', new Error('boom'));
    await expect(p).rejects.toThrow('boom');
  });

  it('treats the cap as inclusive (exactly limit bytes is allowed)', async () => {
    const req = fakeReq();
    const p = readBodyCapped(req, 5);
    req.emit('data', Buffer.from('12345')); // exactly 5
    req.emit('end');
    expect(await p).toBe('12345');
  });
});
