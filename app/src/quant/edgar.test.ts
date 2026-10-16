import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ageText, filingUrl, freshness, latest13F, parseForm4, parseStake, parseSubmissions, rawDocPath, recentLive, type SecFiling } from "./edgar";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const filing = (o: Partial<SecFiling> = {}): SecFiling => ({ accession: "0001193125-26-414744", form: "4", filed: "2026-10-05", accepted: "2026-10-06T05:02:56Z", doc: "xslF345X06/ownership.xml", cik: "1067983", ...o });

describe("submissions", () => {
  const filings = parseSubmissions(JSON.parse(fx("submissions-berkshire.json")), "0001067983");
  it("reads each filing with its acceptance time", () => {
    expect(filings[0]).toEqual({ accession: "0001193125-26-417254", form: "SCHEDULE 13G/A", filed: "2026-10-07", accepted: "2026-10-08T05:47:30Z", doc: "xslSCHEDULE_13G_X02/primary_doc.xml", cik: "1067983" });
    expect(parseSubmissions({}, "1")).toEqual([]);
  });
  it("keeps insider and stake filings inside the window, newest first, one per accession", () => {
    const dup = [...filings, { ...filings[1], cik: "315090" }];
    const live = recentLive(dup, "2026-10-16T12:00:00Z");
    expect(live[0].form).toBe("SCHEDULE 13G/A");
    expect(live.every((f) => ["SCHEDULE 13G/A", "SCHEDULE 13G", "4", "3"].includes(f.form))).toBe(true);
    expect(live.map((f) => f.accepted)).toEqual([...live.map((f) => f.accepted)].sort().reverse());
    expect(new Set(live.map((f) => f.accession)).size).toBe(live.length);
    expect(live.every((f) => f.form !== "SD")).toBe(true);
    expect(recentLive(filings, "2027-06-01T00:00:00Z")).toEqual([]);
    expect(recentLive(filings, "2026-10-16T12:00:00Z", 120, 2)).toHaveLength(2);
  });
  it("builds the viewable and raw document paths", () => {
    expect(filingUrl(filing())).toBe("https://www.sec.gov/Archives/edgar/data/1067983/000119312526414744/xslF345X06/ownership.xml");
    expect(rawDocPath(filing())).toBe("/Archives/edgar/data/1067983/000119312526414744/ownership.xml");
    expect(latest13F([filing({ form: "13F-HR", filed: "2026-08-14" }), filing({ form: "13F-HR", filed: "2026-05-15" }), filing()])?.filed).toBe("2026-08-14");
  });
});

describe("Form 4: Berkshire buying Lennar (real filing, 5 October 2026)", () => {
  const rows = parseForm4(fx("form4-berkshire-lennar.xml"), filing());
  it("reads the purchases with trade date, filing time, shares, price and holding after", () => {
    const buys = rows.filter((r) => r.side === "buy");
    expect(buys.length).toBeGreaterThan(0);
    const first = buys.find((r) => r.date === "2026-10-01")!;
    expect(first).toMatchObject({ symbol: "LEN", action: "Open-market purchase", form: "4", filed: "2026-10-05", accepted: "2026-10-06T05:02:56Z" });
    expect(first.asset).toMatch(/^LENNAR CORP/);
    expect(first.shares!).toBeGreaterThan(0);
    expect(first.price!).toBeGreaterThan(70);
    expect(first.value!).toBeCloseTo(first.shares! * first.price!, 0);
    expect(first.detail).toMatch(/BERKSHIRE HATHAWAY INC and BUFFETT WARREN E/);
    expect(first.detail).toMatch(/10% owner/);
    expect(first.detail).toMatch(/held after/);
  });
  it("sums lines of the same kind on the same day instead of repeating them", () => {
    const keys = rows.map((r) => [r.date, r.action, r.asset].join("|"));
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.length).toBeLessThan(15);
  });
});

describe("Schedule 13G and 13D", () => {
  it("reads Buffett's 13G/A: the largest holding, its percent of the class, the event date", () => {
    const [r] = parseStake(fx("sched13ga-buffett-lennar.xml"), filing({ form: "SCHEDULE 13G/A", doc: "xslSCHEDULE_13G_X02/primary_doc.xml", accepted: "2026-10-08T05:47:30Z", filed: "2026-10-07" }));
    expect(r).toMatchObject({ category: "stake", side: "other", date: "2026-09-30", form: "SCHEDULE 13G/A", shares: 26034436 });
    expect(r.asset).toMatch(/^LENNAR CORPORATION · Class A Common Stock/);
    expect(r.action).toBe("Stake report (13G amendment 1)");
    expect(r.detail).toMatch(/12\.5% of the class/);
    expect(r.detail).toMatch(/26,034,436 shares/);
    expect(r.detail).toMatch(/Warren E\. Buffett, Berkshire Hathaway Inc\., National Indemnity Company and \d+ more/);
  });
  it("reads Pershing Square's 13D/A with its different tag names", () => {
    const [r] = parseStake(fx("sched13da-pershing-hhh.xml"), filing({ form: "SCHEDULE 13D/A", filed: "2026-06-08", accepted: "2026-06-08T22:05:34Z", cik: "1336528" }));
    expect(r).toMatchObject({ date: "2026-06-04", shares: 27852064, action: "Stake report (13D amendment 33)" });
    expect(r.asset).toMatch(/^Howard Hughes Holdings Inc\./);
    expect(r.detail).toMatch(/46\.7% of the class/);
  });
});

describe("freshness", () => {
  it("says how old the newest filing is", () => {
    expect(ageText("2026-10-16T11:30:00Z", "2026-10-16T12:00:00Z")).toBe("30 min ago");
    expect(ageText("2026-10-16T02:00:00Z", "2026-10-16T12:00:00Z")).toBe("10 h ago");
    expect(ageText("2026-10-05T12:00:00Z", "2026-10-16T12:00:00Z")).toBe("11 days ago");
    const f = freshness(parseForm4(fx("form4-berkshire-lennar.xml"), filing()), "2026-10-16T12:00:00Z");
    expect(f).toMatchObject({ newestAccepted: "2026-10-06T05:02:56Z", newestForm: "4", age: "10 days ago" });
    expect(freshness([], "2026-10-16T12:00:00Z").newestAccepted).toBeNull();
  });
});

describe("fetching with a retry (lib/edgar)", () => {
  it("retries once after a throttle and gives up after a second failure", async () => {
    const { fetchSubmissions } = await import("@/lib/edgar");
    let calls = 0;
    const flaky = (async () => (++calls === 1 ? new Response("", { status: 429 }) : new Response(JSON.stringify(JSON.parse(fx("submissions-berkshire.json"))), { status: 200 }))) as unknown as typeof fetch;
    expect((await fetchSubmissions("1067983", flaky)).length).toBe(12);
    expect(calls).toBe(2);
    calls = 0;
    const down = (async () => { calls++; return new Response("", { status: 503 }); }) as unknown as typeof fetch;
    await expect(fetchSubmissions("1067983", down)).rejects.toThrow(/503/);
    expect(calls).toBe(2);
    const forbidden = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    await expect(fetchSubmissions("1067983", forbidden)).rejects.toThrow(/STOCKHUB_SEC_CONTACT/);
  }, 20000);
});
