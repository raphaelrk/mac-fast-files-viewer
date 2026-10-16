/** Finder-style selection, separate from the item currently being previewed. */
export class FileSelection {
  ids = new Set<string>();
  anchor: string | undefined;
  focus: string | undefined;

  clear() { this.ids.clear(); this.anchor = this.focus = undefined; }
  click(id: string, ordered: string[], modifiers: { toggle?: boolean; range?: boolean } = {}) {
    if (modifiers.range) {
      const anchor = this.anchor && ordered.includes(this.anchor) ? this.anchor : this.focus ?? id;
      const start = ordered.indexOf(anchor), end = ordered.indexOf(id);
      if (start < 0 || end < 0) return;
      const range = ordered.slice(Math.min(start, end), Math.max(start, end) + 1);
      this.ids = new Set(modifiers.toggle ? [...this.ids, ...range] : range);
      this.anchor = anchor;
    } else if (modifiers.toggle) {
      if (this.ids.has(id)) this.ids.delete(id); else this.ids.add(id);
      this.anchor = id;
    } else {
      this.ids = new Set([id]); this.anchor = id;
    }
    this.focus = id;
  }
  /** Dragging an already-selected row must preserve the rest of the selection. */
  dragIds(id: string, ordered: string[]) {
    return this.ids.has(id) ? ordered.filter(value => this.ids.has(value)) : [id];
  }
  retain(allowed: Set<string>) {
    this.ids = new Set([...this.ids].filter(id => allowed.has(id)));
    if (this.anchor && !allowed.has(this.anchor)) this.anchor = undefined;
    if (this.focus && !allowed.has(this.focus)) this.focus = undefined;
  }
}
