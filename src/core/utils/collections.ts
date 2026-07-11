// Small, dependency-free collection helpers.

export interface HasId {
  id: string;
}

/**
 * Insert `item` into `list`, or replace the existing element that shares its
 * `id` — in place, preserving order. Mutates `list` and returns it.
 *
 * Used wherever an append-only feed can re-deliver the same logical record
 * (peer reconnect, feed re-load): a plain push would pile up duplicates that
 * skew any downstream count or filter.
 */
export function upsertById<T extends HasId>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    list[idx] = item;
  } else {
    list.push(item);
  }
  return list;
}
