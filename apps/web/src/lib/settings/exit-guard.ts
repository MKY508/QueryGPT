export interface SettingsExitState { revision: number; dirty: boolean; busy: boolean }
interface PendingExit { target: string; signature: string; busy: boolean; resolve: (allowed: boolean) => void }

/** One workspace owns this registry. It stores readers and revision markers,
 * never authored settings, passwords or serialized form values. */
export class SettingsExitGuard {
  private readers = new Map<string, { read: () => SettingsExitState; discard: () => void }>();
  private listeners = new Set<() => void>();
  private version = 0;
  private closeSignature: string | null = null;
  pending: PendingExit | null = null;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.version;
  private emit() { this.version += 1; this.listeners.forEach(listener => listener()); }
  inspect() {
    const entries = [...this.readers].map(([id, { read }]) => {
      try { return { id, ...read() }; } catch { return { id, revision: -1, dirty: false, busy: true }; }
    }).filter(entry => entry.dirty || entry.busy);
    return { dirty: entries.some(entry => entry.dirty), busy: entries.some(entry => entry.busy), signature: JSON.stringify(entries) };
  }
  register(id: string, read: () => SettingsExitState, discard: () => void) {
    this.cancelClose();
    const entry = { read, discard };
    this.readers.set(id, entry); this.changed();
    return () => { if (this.readers.get(id) === entry) { this.cancelClose(); this.readers.delete(id); this.changed(); } };
  }
  changed = () => {
    if (this.pending && this.pending.signature !== this.inspect().signature) this.finish(false);
    else this.emit();
  };
  request(target: string): Promise<boolean> {
    this.finish(false);
    const state = this.inspect();
    if (!state.dirty && !state.busy) return Promise.resolve(true);
    return new Promise(resolve => { this.pending = { target, signature: state.signature, busy: state.busy, resolve }; this.emit(); });
  }
  inspectClose = (): "busy" | "settings" | "clean" => {
    const state = this.inspect();
    return state.busy ? "busy" : state.dirty ? "settings" : "clean";
  };
  prepareClose = () => { this.finish(false); this.closeSignature = this.inspect().signature; };
  cancelClose = () => { this.closeSignature = null; };
  discardClose = () => {
    const expected = this.closeSignature;
    this.closeSignature = null;
    return expected !== null && this.discardSnapshot(expected);
  };
  private discardSnapshot(signature: string) {
    const current = this.inspect();
    if (current.busy || current.signature !== signature) return false;
    try { for (const entry of this.readers.values()) if (entry.read().dirty) entry.discard(); }
    catch { return false; }
    const remaining = this.inspect();
    return !remaining.dirty && !remaining.busy;
  }
  finish(allowed: boolean, expected = this.pending) {
    const pending = this.pending;
    if (!pending || pending !== expected) return;
    this.pending = null;
    const accepted = allowed && this.discardSnapshot(pending.signature);
    pending.resolve(accepted);
    this.emit();
  }
}
