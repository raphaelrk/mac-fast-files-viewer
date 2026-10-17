/** A shared admission budget: queued work does not reserve memory until it runs. */
export class WorkQueue {
  private jobs: { key: string; owner?: string; bytes: number; priority: number; run: () => Promise<unknown>; resolve: (value: any) => void; reject: (error: unknown) => void }[] = [];
  private pending = new Map<string, Promise<any>>();
  activeBytes = 0;
  active = 0;
  constructor(readonly budget = 500 * 1024 ** 2, readonly concurrency = 3) {}
  get queued() { return this.jobs.length; }

  submit<T>(key: string, bytes: number, priority: number, run: () => Promise<T>, owner?: string): Promise<T> {
    if (bytes > this.budget) return Promise.reject(new Error("Image exceeds the processing budget"));
    const existing = this.pending.get(key);
    if (existing) {
      const job = this.jobs.find(j => j.key === key);
      if (job) job.priority = Math.min(priority, job.priority);
      return existing;
    }
    const promise = new Promise<T>((resolve, reject) => {
      this.jobs.push({ key, owner, bytes, priority, run, resolve, reject });
    });
    this.pending.set(key, promise);
    this.pump();
    return promise;
  }
  cancelQueued(keep: Set<string>, owner?: string) {
    this.jobs = this.jobs.filter(job => {
      if ((owner !== undefined && job.owner !== owner) || keep.has(job.key)) return true;
      this.pending.delete(job.key);
      job.reject(new Error("Superseded"));
      return false;
    });
  }
  private pump() {
    this.jobs.sort((a, b) => a.priority - b.priority);
    while (this.active < this.concurrency) {
      const index = this.jobs.findIndex(job => this.activeBytes + job.bytes <= this.budget);
      if (index < 0) break;
      const [job] = this.jobs.splice(index, 1);
      this.active++;
      this.activeBytes += job.bytes;
      void Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
        this.active--; this.activeBytes -= job.bytes; this.pending.delete(job.key); this.pump();
      });
    }
  }
}

/** Byte-counted LRU for encoded thumbnails and bounded text, never original images. */
export class ByteCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  bytes = 0;
  constructor(readonly limit: number) {}
  get(key: string): T | undefined {
    const item = this.entries.get(key);
    if (!item) return;
    this.entries.delete(key); this.entries.set(key, item);
    return item.value;
  }
  set(key: string, value: T, bytes: number) {
    const previous = this.entries.get(key);
    if (previous) { this.bytes -= previous.bytes; this.entries.delete(key); }
    if (bytes > this.limit) return;
    this.entries.set(key, { value, bytes }); this.bytes += bytes;
    while (this.bytes > this.limit) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
    }
  }
  clear() { this.entries.clear(); this.bytes = 0; }
}
