import type { NewsItem } from "./api";

export type FeedKind = "yahoo" | "google";

export function parseRssItems(xml: string, kind: FeedKind, symbol: string): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) return [];

  return Array.from(doc.querySelectorAll("item")).flatMap((el) => {
    const text = (tag: string) => el.querySelector(tag)?.textContent?.trim() || undefined;
    let title = text("title");
    const url = text("link");
    if (!title || !url) return [];

    const pub = text("pubDate");
    const parsed = pub ? new Date(pub) : undefined;
    const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : "";

    // Google titles end with " - Publisher"; Yahoo items carry no publisher.
    let source = kind === "yahoo" ? "Yahoo Finance" : text("source");
    if (kind === "google" && source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3));
    }

    return [{
      id: text("guid") ?? url,
      date, title, url, source, symbol,
      summary: kind === "yahoo" ? text("description") : undefined,
    }];
  });
}
