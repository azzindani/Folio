import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeStep, clamp, roundToStep, attachWheelAdjust } from './wheel-adjust';

describe('wheel-adjust pure helpers', () => {
  it('computeStep: scroll up increments, scroll down decrements', () => {
    expect(computeStep({ deltaY: -100 })).toBe(1);
    expect(computeStep({ deltaY: 100 })).toBe(-1);
    expect(computeStep({ deltaY: 0 })).toBe(0);
  });

  it('computeStep: shift scales by 10, alt by 0.1', () => {
    expect(computeStep({ deltaY: -1, shift: true })).toBe(10);
    expect(computeStep({ deltaY: -1, alt: true })).toBeCloseTo(0.1);
  });

  it('computeStep: respects custom step', () => {
    expect(computeStep({ deltaY: -1, step: 5 })).toBe(5);
    expect(computeStep({ deltaY: -1, step: 0.5, shift: true })).toBe(5);
  });

  it('clamp: bounds value', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
    expect(clamp(99, NaN, NaN)).toBe(99);
  });

  it('roundToStep: integer step → integer', () => {
    expect(roundToStep(3.7, 1)).toBe(4);
    expect(roundToStep(3.4, 5)).toBe(3);
  });

  it('roundToStep: fractional step → matching decimals', () => {
    expect(roundToStep(0.123456, 0.01)).toBe(0.12);
    expect(roundToStep(0.123456, 0.001)).toBe(0.123);
  });
});

describe('attachWheelAdjust', () => {
  let input: HTMLInputElement;
  let dispose: () => void;

  beforeEach(() => {
    input = document.createElement('input');
    input.type = 'number';
    input.value = '10';
    input.step = '1';
    document.body.appendChild(input);
    input.focus();
    dispose = attachWheelAdjust(input);
  });

  afterEach(() => {
    dispose();
    input.remove();
  });

  it('increments on wheel up', () => {
    input.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    expect(input.value).toBe('11');
  });

  it('decrements on wheel down', () => {
    input.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    expect(input.value).toBe('9');
  });

  it('shift = ×10', () => {
    input.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, shiftKey: true, bubbles: true, cancelable: true }));
    expect(input.value).toBe('20');
  });

  it('respects min/max', () => {
    input.min = '0';
    input.max = '15';
    input.value = '14';
    input.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, shiftKey: true, bubbles: true, cancelable: true }));
    expect(input.value).toBe('15');
  });

  it('dispatches input + change events', () => {
    let inputs = 0;
    let changes = 0;
    input.addEventListener('input', () => inputs++);
    input.addEventListener('change', () => changes++);
    input.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    expect(inputs).toBe(1);
    expect(changes).toBe(1);
  });
});
