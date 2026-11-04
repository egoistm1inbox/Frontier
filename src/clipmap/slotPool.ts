/** Fixed-capacity free list of atlas slots. */
export class SlotPool {
  private readonly free: number[] = [];
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    for (let s = capacity - 1; s >= 0; s--) this.free.push(s);
  }

  /** Returns a free slot index, or -1 when the pool is exhausted. */
  acquire(): number {
    return this.free.length > 0 ? this.free.pop()! : -1;
  }

  release(slot: number): void {
    if (slot < 0 || slot >= this.capacity) throw new Error(`slot ${slot} out of range`);
    this.free.push(slot);
  }

  get available(): number {
    return this.free.length;
  }

  get inUse(): number {
    return this.capacity - this.free.length;
  }
}
