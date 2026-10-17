import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchLiveFeed, SEC_CONFIGURED } from "@/lib/edgar";
import { batchNotifications, newAlerts, titleWithCount } from "@/quant/alerts";
import { edgarCiks } from "@/quant/personas";
import { allPersonas, usePersonas } from "@/store/personaStore";

const BASE_TITLE = "StockHub";
export const WATCH_MINUTES = 10;

/**
 * Runs while any StockHub tab is open: rechecks followed personas' SEC filings every ten minutes,
 * puts the number of new filings in the tab title, and shows one browser notification per new filing
 * when alerts are on and allowed. Shares the Personas screen's queries, so nothing is fetched twice.
 */
export function PersonaWatcher() {
  const { followed, custom, seen, markSeen, alerts, muted, notified, addNotified } = usePersonas();
  const watched = useMemo(() => (SEC_CONFIGURED ? allPersonas(custom).filter((p) => followed.includes(p.id) && edgarCiks(p).length > 0) : []), [custom, followed]);
  const qs = useQueries({
    queries: watched.map((p) => ({
      queryKey: ["persona-live", p.id, edgarCiks(p).join(",")],
      queryFn: () => fetchLiveFeed(edgarCiks(p)),
      enabled: alerts, staleTime: 4 * 60_000,
      refetchInterval: alerts ? WATCH_MINUTES * 60_000 : false as const, refetchIntervalInBackground: true, retry: 1,
    })),
  });
  const stamp = qs.map((q) => q.dataUpdatedAt).join("|");

  useEffect(() => {
    if (!alerts) { document.title = BASE_TITLE; return; }
    const done = new Set(notified);
    let unseen = 0;
    const fresh: ReturnType<typeof newAlerts> = [];
    watched.forEach((p, i) => {
      const feed = qs[i]?.data;
      if (!feed) return;
      // a persona never looked at gets its baseline now, so its history is not announced as new
      if (seen[p.id] === undefined) { markSeen(p.id, feed.fresh.newestAccepted ?? feed.checkedAt); return; }
      if (muted.includes(p.id)) return;
      // the same filings the alerts would announce: purchases, sales and stake reports since the last look
      unseen += newAlerts(p.id, p.name, feed.events, seen[p.id], new Set()).length;
      fresh.push(...newAlerts(p.id, p.name, feed.events, seen[p.id], done));
    });
    document.title = titleWithCount(BASE_TITLE, unseen);
    if (!fresh.length) return;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const n of batchNotifications(fresh)) new Notification(n.title, { body: n.body, tag: n.tag });
    }
    addNotified(fresh.map((a) => a.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, alerts, seen, muted.join(",")]);

  return null;
}
