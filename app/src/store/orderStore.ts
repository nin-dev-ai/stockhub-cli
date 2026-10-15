import { create } from "zustand";
import { persist } from "zustand/middleware";
import { auditEntry, DEFAULT_LIMITS, validateLimits, type AuditEntry, type AuditKind, type OrderLimits, type ProposedOrder } from "@/quant/orders";

/** Kept per browser. The audit log is append-only; the oldest entries roll off past this length. */
const MAX_AUDIT = 5000;

interface OrderState {
  audit: AuditEntry[];
  killSwitch: boolean;
  limits: OrderLimits;
  log: (kind: AuditKind, accountId: string | null, detail: string, o?: ProposedOrder) => void;
  setKillSwitch: (on: boolean, accountId: string | null, detail: string) => void;
  /** Returns errors; empty when the limits were saved. */
  setLimits: (l: OrderLimits, accountId: string | null) => string[];
}

export const useOrders = create<OrderState>()(
  persist(
    (set, get) => ({
      audit: [],
      killSwitch: false,
      limits: DEFAULT_LIMITS,
      log: (kind, accountId, detail, o) => set({ audit: [...get().audit, auditEntry(kind, accountId, detail, o)].slice(-MAX_AUDIT) }),
      setKillSwitch: (on, accountId, detail) => {
        set({ killSwitch: on });
        get().log(on ? "kill_switch" : "trading_enabled", accountId, detail);
      },
      setLimits: (l, accountId) => {
        const errs = validateLimits(l);
        if (errs.length) return errs;
        set({ limits: l });
        get().log("limits_changed", accountId, `Per-order cap $${l.maxOrderNotional}, daily cap $${l.maxDailyNotional}.`);
        return [];
      },
    }),
    { name: "stockhub-orders" },
  ),
);
