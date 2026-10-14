// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseRssItems } from "./news";
import { fetchNewsCompany } from "./api";

const YAHOO = `<?xml version="1.0"?><rss><channel>
<item><title>Tesla event is back on</title><description>Roadster news.</description>
<guid isPermaLink="false">abc-1</guid><link>https://finance.yahoo.com/a1</link>
<pubDate>Wed, 14 Oct 2026 16:33:58 +0000</pubDate></item>
<item><title>No link here</title></item>
</channel></rss>`;

const GOOGLE = `<?xml version="1.0"?><rss><channel>
<item><title>Tesla turns to desert sun - CarbonCredits.com</title>
<link>https://news.google.com/rss/articles/xyz</link><guid>g-1</guid>
<pubDate>Wed, 14 Oct 2026 17:16:59 GMT</pubDate>
<source url="https://carboncredits.com">CarbonCredits.com</source></item>
</channel></rss>`;

const EMPTY = `<?xml version="1.0"?><rss><channel></channel></rss>`;

const feeds = (map: Record<string, { status?: number; body?: string }>) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const key = Object.keys(map).find((k) => url.startsWith(k))!;
    const { status = 200, body = "" } = map[key];
    return { ok: status < 400, status, text: async () => body };
  }));

afterEach(() => vi.unstubAllGlobals());

describe("parseRssItems", () => {
  it("maps Yahoo items and skips entries without a link", () => {
    const items = parseRssItems(YAHOO, "yahoo", "TSLA");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "abc-1", title: "Tesla event is back on", url: "https://finance.yahoo.com/a1",
      source: "Yahoo Finance", summary: "Roadster news.", symbol: "TSLA",
      date: "2026-10-14T16:33:58.000Z",
    });
  });

  it("splits the publisher off Google titles", () => {
    const [item] = parseRssItems(GOOGLE, "google", "TSLA");
    expect(item.title).toBe("Tesla turns to desert sun");
    expect(item.source).toBe("CarbonCredits.com");
    expect(item.summary).toBeUndefined();
  });

  it("returns an empty list for malformed XML", () => {
    expect(parseRssItems("<rss><item>", "yahoo", "X")).toEqual([]);
  });
});

describe("fetchNewsCompany", () => {
  it("uses Yahoo when it has headlines", async () => {
    feeds({ "/rss/yahoo": { body: YAHOO }, "/rss/google": { body: GOOGLE } });
    const items = await fetchNewsCompany("TSLA");
    expect(items.map((i) => i.source)).toEqual(["Yahoo Finance"]);
  });

  it("falls back to Google when Yahoo is empty", async () => {
    feeds({ "/rss/yahoo": { body: EMPTY }, "/rss/google": { body: GOOGLE } });
    const items = await fetchNewsCompany("TSLA");
    expect(items[0].source).toBe("CarbonCredits.com");
  });

  it("falls back to Google when Yahoo errors", async () => {
    feeds({ "/rss/yahoo": { status: 404 }, "/rss/google": { body: GOOGLE } });
    expect(await fetchNewsCompany("TSLA")).toHaveLength(1);
  });

  it("surfaces an error when both feeds fail", async () => {
    feeds({ "/rss/yahoo": { status: 500 }, "/rss/google": { status: 503 } });
    await expect(fetchNewsCompany("TSLA")).rejects.toThrow(/google news feed returned 503/);
  });

  it("respects the limit", async () => {
    feeds({ "/rss/yahoo": { body: YAHOO.replace("<item><title>No link", `<item><title>Second</title><link>https://x/2</link></item><item><title>No link`) } });
    expect(await fetchNewsCompany("TSLA", 1)).toHaveLength(1);
  });
});
