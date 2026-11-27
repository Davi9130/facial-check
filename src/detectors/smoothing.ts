/**
 * Exponential moving average: `next = alpha·sample + (1 − alpha)·previous`.
 * `alpha = 1` returns the samples unchanged.
 */
export class ExponentialMovingAverage {
  private current: number | null = null;

  constructor(readonly alpha: number) {
    if (!(alpha > 0 && alpha <= 1)) throw new RangeError("ExponentialMovingAverage: alpha must be in (0, 1].");
  }

  get value(): number | null {
    return this.current;
  }

  push(sample: number): number {
    this.current = this.current === null ? sample : this.alpha * sample + (1 - this.alpha) * this.current;
    return this.current;
  }

  reset(): void {
    this.current = null;
  }
}
