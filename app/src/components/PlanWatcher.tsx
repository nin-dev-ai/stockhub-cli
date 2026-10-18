import { useEffect, useMemo, useSyncExternalStore } from "react";
import { jobs } from "@/quant/jobs";
import { planTodo, type TodoItem } from "@/quant/planTodo";
import { submitTracking, trackingInput, type TrackingData } from "@/quant/useTracking";
import { titleWithCount } from "@/quant/alerts";
import { usePlanAlerts } from "@/store/planAlertStore";
import { usePortfolios } from "@/store/portfolioStore";
import { useTitleCounts } from "@/store/titleStore";

export const PLAN_WATCH_MINUTES = 60;
const BASE_TITLE = "StockHub";

/** Every saved plan's to-do items from its shared refresh job; empty until the job has run. */
export function useAllTodos(): { portfolioId: string; name: string; items: TodoItem[] }[] {
  useSyncExternalStore(jobs.subscribe, jobs.getVersion);
  const { portfolios, snapshots } = usePortfolios();
  return portfolios.flatMap((p) => {
    const original = snapshots.find((s) => s.id === p.snapshotIds[0]);
    if (!original) return [];
    const data = jobs.get<TrackingData>(jobs.idFor("port-refresh", trackingInput(p, original)))?.result;
    if (!data?.plan || !data.holdings) return [];
    return [{ portfolioId: p.id, name: p.name, items: planTodo({ portfolio: p, original, results: data.plan.results, targets: data.plan.targets, panel: data.holdings.panel }) }];
  });
}

/**
 * Runs while StockHub is open: when plan alerts are on, refreshes each saved plan on start and every
 * hour (the same job My Portfolio uses, so nothing runs twice), shows one browser notification per new
 * to-do item and adds the open items to the tab title.
 */
export function PlanWatcher() {
  const { alerts, muted, notified, addNotified } = usePlanAlerts();
  const { portfolios, snapshots } = usePortfolios();
  const todos = useAllTodos();
  const setCount = useTitleCounts((s) => s.setCount);
  const counts = useTitleCounts((s) => s.counts);

  useEffect(() => {
    if (!alerts) return;
    const run = () => {
      for (const p of portfolios) {
        const original = snapshots.find((s) => s.id === p.snapshotIds[0]);
        if (original && !muted.includes(p.id)) submitTracking(p, original);
      }
    };
    run();
    const t = setInterval(run, PLAN_WATCH_MINUTES * 60_000);
    return () => clearInterval(t);
  }, [alerts, portfolios, snapshots, muted]);

  const live = useMemo(() => todos.filter((t) => !muted.includes(t.portfolioId)), [todos, muted]);
  const keys = live.flatMap((t) => t.items.map((i) => i.key)).join("|");
  useEffect(() => {
    setCount("plans", alerts ? live.reduce((s, t) => s + t.items.length, 0) : 0);
    if (!alerts) return;
    const done = new Set(notified);
    const fresh = live.flatMap((t) => t.items.filter((i) => !done.has(i.key)).map((i) => ({ ...i, name: t.name })));
    if (!fresh.length) return;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const f of fresh.slice(0, 4)) new Notification(`${f.name}: ${f.title}`, { body: f.detail, tag: f.key });
      if (fresh.length > 4) new Notification(`${fresh.length - 4} more plan items`, { body: "Open My Portfolio to see them.", tag: "plans-more" });
    }
    addNotified(fresh.map((f) => f.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, alerts]);

  // one title for every watcher: personas and plans add their counts
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  useEffect(() => { document.title = titleWithCount(BASE_TITLE, total); }, [total]);
  return null;
}
