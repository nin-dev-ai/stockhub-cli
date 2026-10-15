import { create } from "zustand";
import { persist } from "zustand/middleware";
import { hashId } from "@/quant/hash";
import {
  checkLedger, finalizeTx, validateTx, type PlanSnapshot, type Portfolio, type PortfolioMode, type TxDraft,
} from "@/quant/tracking";

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

interface PortfolioState {
  portfolios: Portfolio[];
  /** Append-only. A snapshot is never edited; deleting its portfolio is the only way to remove it. */
  snapshots: PlanSnapshot[];
  selectedId: string | null;
  createPortfolio: (a: { name: string; mode: PortfolioMode; snapshot?: (portfolioId: string) => PlanSnapshot; opening?: TxDraft[] }) => { id: string } | { error: string };
  addSnapshot: (portfolioId: string, s: PlanSnapshot) => string | null;
  /** Validates against the ledger; returns error messages, empty on success. */
  addTransactions: (portfolioId: string, drafts: TxDraft[]) => string[];
  deleteTransaction: (portfolioId: string, txId: string) => string[];
  renamePortfolio: (id: string, name: string) => void;
  deletePortfolio: (id: string) => void;
  select: (id: string | null) => void;
}

export const usePortfolios = create<PortfolioState>()(
  persist(
    (set, get) => ({
      portfolios: [],
      snapshots: [],
      selectedId: null,

      createPortfolio: ({ name, mode, snapshot, opening = [] }) => {
        const clean = name.trim();
        if (!clean) return { error: "Enter a name." };
        if (get().portfolios.some((p) => p.name.toLowerCase() === clean.toLowerCase())) return { error: "A portfolio with this name already exists." };
        const createdAt = now();
        const id = `pf_${hashId({ clean, createdAt }).slice(0, 10)}`;
        const snap = snapshot?.(id);
        let p: Portfolio = { id, name: clean, mode, baseCurrency: "USD", createdAt, snapshotIds: snap ? [snap.id] : [], transactions: [] };
        for (const d of opening) {
          const errs = validateTx(p.transactions, d, today());
          if (errs.length) return { error: errs.join(" ") };
          p = { ...p, transactions: [...p.transactions, finalizeTx(d, txId(p, d), now())] };
        }
        set({ portfolios: [...get().portfolios, p], snapshots: snap ? [...get().snapshots, snap] : get().snapshots, selectedId: id });
        return { id };
      },

      addSnapshot: (portfolioId, s) => {
        const p = get().portfolios.find((x) => x.id === portfolioId);
        if (!p) return "Portfolio not found.";
        if (s.portfolioId !== portfolioId) return "This snapshot belongs to another portfolio.";
        if (get().snapshots.some((x) => x.id === s.id)) return null; // identical content already saved
        set({
          snapshots: [...get().snapshots, s],
          portfolios: get().portfolios.map((x) => (x.id === portfolioId ? { ...x, snapshotIds: [...x.snapshotIds, s.id] } : x)),
        });
        return null;
      },

      addTransactions: (portfolioId, drafts) => {
        const p = get().portfolios.find((x) => x.id === portfolioId);
        if (!p) return ["Portfolio not found."];
        let txs = p.transactions;
        for (const d of drafts) {
          const errs = validateTx(txs, d, today());
          if (errs.length) return errs;
          txs = [...txs, finalizeTx(d, txId({ ...p, transactions: txs }, d), now())];
        }
        set({ portfolios: get().portfolios.map((x) => (x.id === portfolioId ? { ...x, transactions: txs } : x)) });
        return [];
      },

      deleteTransaction: (portfolioId, id) => {
        const p = get().portfolios.find((x) => x.id === portfolioId);
        if (!p) return ["Portfolio not found."];
        const rest = p.transactions.filter((t) => t.id !== id);
        // removing an entry must not leave a later state overdrawn or short
        const check = checkLedger(rest);
        if (check.length) return [`Removing this entry would break a later one: ${check[0]}`];
        set({ portfolios: get().portfolios.map((x) => (x.id === portfolioId ? { ...x, transactions: rest } : x)) });
        return [];
      },

      renamePortfolio: (id, name) => {
        const clean = name.trim();
        if (clean) set({ portfolios: get().portfolios.map((p) => (p.id === id ? { ...p, name: clean } : p)) });
      },

      deletePortfolio: (id) => set({
        portfolios: get().portfolios.filter((p) => p.id !== id),
        snapshots: get().snapshots.filter((s) => s.portfolioId !== id),
        selectedId: get().selectedId === id ? null : get().selectedId,
      }),

      select: (id) => set({ selectedId: id }),
    }),
    {
      name: "stockhub-portfolios",
      // re-freeze snapshots loaded from storage so the app cannot mutate them in memory either
      merge: (saved, cur) => {
        const s = (saved ?? {}) as Partial<PortfolioState>;
        return { ...cur, ...s, snapshots: (s.snapshots ?? []).map((x) => refreeze(x)) };
      },
    },
  ),
);

function txId(p: Portfolio, d: TxDraft) {
  return `tx_${hashId({ p: p.id, n: p.transactions.length, d, t: now() }).slice(0, 12)}`;
}

/** Freeze without recomputing the id, so tampering in storage stays detectable by verifySnapshot. */
function refreeze(s: PlanSnapshot): PlanSnapshot {
  const freeze = (o: unknown) => { if (o && typeof o === "object") { Object.freeze(o); Object.values(o).forEach(freeze); } };
  freeze(s);
  return s;
}

export const snapshotsOf = (p: Portfolio, all: PlanSnapshot[]): PlanSnapshot[] =>
  p.snapshotIds.map((id) => all.find((s) => s.id === id)).filter((s): s is PlanSnapshot => !!s);
