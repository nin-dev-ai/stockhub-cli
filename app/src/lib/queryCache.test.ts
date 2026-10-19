import { beforeEach, describe, expect, it } from "vitest";
import { ageOf, cachedQuery, MAX_ENTRIES, readCached, writeCached } from "./queryCache";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
  };
});

describe("query cache", () => {
  it("starts a query from the saved result with its real age, and saves each fresh result", async () => {
    writeCached(["persona-live", "a"], { n: 1 }, 1000);
    const q = cachedQuery(["persona-live", "a"], async () => ({ n: 2 }));
    expect(q.initialData).toEqual({ n: 1 });
    expect(q.initialDataUpdatedAt).toBe(1000);
    expect(await q.queryFn()).toEqual({ n: 2 });
    expect(readCached(["persona-live", "a"])!.data).toEqual({ n: 2 });
    expect("initialData" in cachedQuery(["persona-live", "never"], async () => 0)).toBe(false);
  });
  it("keeps only the newest entries", () => {
    for (let i = 0; i < MAX_ENTRIES + 5; i++) writeCached(["k", i], i);
    expect([...store.keys()].filter((k) => k.startsWith("stockhub-qcache:")).length).toBe(MAX_ENTRIES);
    expect(readCached(["k", MAX_ENTRIES + 4])!.data).toBe(MAX_ENTRIES + 4);
  });
  it("says how old a result is", () => {
    expect(ageOf(0, 30_000)).toBe("just now");
    expect(ageOf(0, 12 * 60_000)).toBe("12 min ago");
    expect(ageOf(0, 3 * 3600_000)).toBe("3 h ago");
    expect(ageOf(0, 72 * 3600_000)).toBe("3 days ago");
  });
});
