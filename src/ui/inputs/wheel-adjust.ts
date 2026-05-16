/**
 * wheel-adjust — composable mouse-wheel stepper for `<input type="number">`.
 *
 * Architecture: pure logic + thin DOM adapter. The pure step calculation
 * lives in `computeStep` so it can be tested without a browser; the
 * `attachWheelAdjust` adapter wires it onto an element.
 *
 * Modifiers (industry convention):
 *   default        → step × 1   (1 unit / wheel notch)
 *   Shift          → step × 10  (coarse)
 *   Alt / Option   → step × 0.1 (fine)
 *
 * The handler only fires when the input is hovered or focused, so page
 * scroll still works when the cursor is elsewhere.
 */
export interface WheelStepInput {
  /** deltaY from the wheel event */
  deltaY: number;
  /** modifier flags */
  shift?: boolean;
  alt?: boolean;
  /** base step from the input's `step` attr (defaults to 1) */
  step?: number;
}

/** Pure: compute the signed amount to add to the input's current value. */
export function computeStep({ deltaY, shift = false, alt = false, step = 1 }: WheelStepInput): number {
  if (deltaY === 0) return 0;
  const dir = deltaY < 0 ? 1 : -1; // wheel up → increment
  const factor = shift ? 10 : alt ? 0.1 : 1;
  return dir * step * factor;
}

/** Pure: clamp a value to [min, max] when those are finite. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isFinite(min) && value < min) return min;
  if (Number.isFinite(max) && value > max) return max;
  return value;
}

/** Pure: round to a sane number of decimals based on step magnitude. */
export function roundToStep(value: number, step: number): number {
  if (step >= 1) return Math.round(value);
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step))));
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

export interface AttachOptions {
  /** Fire `input` + `change` after each step so listeners react. Default: true */
  dispatchEvents?: boolean;
}

/**
 * Attach wheel-adjust behaviour to a number input.
 * Returns a disposer.
 */
export function attachWheelAdjust(
  input: HTMLInputElement,
  opts: AttachOptions = {},
): () => void {
  const { dispatchEvents = true } = opts;

  const onWheel = (e: WheelEvent): void => {
    // Only act when this input is hovered or focused — never hijack page scroll.
    const active = document.activeElement === input || input.matches(':hover');
    if (!active) return;

    const stepAttr = parseFloat(input.step) || 1;
    const delta = computeStep({
      deltaY: e.deltaY,
      shift: e.shiftKey,
      alt: e.altKey,
      step: stepAttr,
    });
    if (delta === 0) return;

    e.preventDefault();
    const cur = parseFloat(input.value) || 0;
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const next = roundToStep(clamp(cur + delta, min, max), stepAttr);
    input.value = String(next);

    if (dispatchEvents) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  input.addEventListener('wheel', onWheel, { passive: false });
  return () => input.removeEventListener('wheel', onWheel);
}

/** Convenience: attach to every number input under `root`. */
export function attachWheelAdjustAll(root: ParentNode, opts?: AttachOptions): () => void {
  const inputs = root.querySelectorAll<HTMLInputElement>('input[type="number"]');
  const disposers: Array<() => void> = [];
  inputs.forEach(i => disposers.push(attachWheelAdjust(i, opts)));
  return () => disposers.forEach(d => d());
}
