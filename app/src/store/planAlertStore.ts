import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PlanAlertState {
  /** Browser notifications for plan to-do items; off until the user turns them on. */
  alerts: boolean;
  setAlerts: (on: boolean) => void;
  /** Portfolio ids the user does not want alerts for. */
  muted: string[];
  toggleMute: (id: string) => void;
  /** To-do keys already announced, so none is announced twice. */
  notified: string[];
  addNotified: (keys: string[]) => void;
}

export const usePlanAlerts = create<PlanAlertState>()(
  persist(
    (set, get) => ({
      alerts: false,
      setAlerts: (on) => set({ alerts: on }),
      muted: [],
      toggleMute: (id) => set({ muted: get().muted.includes(id) ? get().muted.filter((x) => x !== id) : [...get().muted, id] }),
      notified: [],
      addNotified: (keys) => set({ notified: [...get().notified, ...keys.filter((k) => !get().notified.includes(k))].slice(-500) }),
    }),
    { name: "stockhub-plan-alerts" },
  ),
);
