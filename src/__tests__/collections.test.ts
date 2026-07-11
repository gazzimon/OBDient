import { upsertById } from '@/core/utils/collections';

interface Row {
  id: string;
  v: number;
}

describe('upsertById', () => {
  it('appends when the id is new', () => {
    const list: Row[] = [{ id: 'a', v: 1 }];
    upsertById(list, { id: 'b', v: 2 });
    expect(list).toEqual([
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
    ]);
  });

  it('replaces in place, preserving position, when the id exists', () => {
    const list: Row[] = [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'c', v: 3 },
    ];
    upsertById(list, { id: 'b', v: 99 });
    expect(list).toEqual([
      { id: 'a', v: 1 },
      { id: 'b', v: 99 },
      { id: 'c', v: 3 },
    ]);
  });

  it('never grows the list on repeated upserts of the same id', () => {
    const list: Row[] = [];
    for (let i = 0; i < 100; i++) upsertById(list, { id: 'x', v: i });
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ id: 'x', v: 99 });
  });

  it('returns the same list reference', () => {
    const list: Row[] = [];
    expect(upsertById(list, { id: 'a', v: 1 })).toBe(list);
  });
});
