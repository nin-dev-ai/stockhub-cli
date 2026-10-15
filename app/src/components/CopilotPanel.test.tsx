// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CopilotPanel } from "./CopilotPanel";
import { useCopilot } from "@/copilot/copilotStore";
import { useCopilotContext } from "@/copilot/context";
import { useStrategies } from "@/store/strategyStore";
import { useWorkspace } from "@/store/workspaceStore";
import { usePortfolios } from "@/store/portfolioStore";
import { PORT } from "@/functions/PORT";
import { CATALOG_BY_ID } from "@/quant/catalog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  useCopilot.setState({ open: true, messages: [] });
  useStrategies.setState({ basket: [], drafts: [] });
  usePortfolios.setState({ portfolios: [], snapshots: [], selectedId: null });
  useCopilotContext.setState({ strategy: null, lab: null, portfolio: null });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const render = (el: JSX.Element) => act(() => root.render(el));
const ask = async (q: string) => {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Ask the Copilot"]')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, q);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
};
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

describe("Copilot panel", () => {
  it("answers a glossary question and shows its source", async () => {
    render(<CopilotPanel />);
    await ask("What is a Sharpe ratio?");
    expect(host.textContent).toMatch(/Sharpe ratio/);
    expect(host.textContent).toMatch(/Sources: StockHub glossary/);
  });

  it("drafts a strategy and saves it only when the user confirms", async () => {
    render(<CopilotPanel />);
    await ask("Create a strategy: hold SPY above its 200-day moving average, otherwise bonds");
    expect(host.textContent).toMatch(/Needs your confirmation/);
    expect(useStrategies.getState().drafts).toHaveLength(0);
    await act(async () => { button("Save draft")!.click(); });
    expect(useStrategies.getState().drafts).toHaveLength(1);
    expect(useStrategies.getState().drafts[0].allocation.type).toBe("trend");
    expect(host.textContent).toMatch(/Saved "Copilot draft/);
  });

  it("uses only the active screen's context", async () => {
    useWorkspace.setState({ tabs: [{ id: "STRAT:_", code: "STRAT" }], activeTabId: "STRAT:_" });
    useCopilotContext.setState({ strategy: { def: CATALOG_BY_ID.permanent_portfolio, result: null, draft: false } });
    render(<CopilotPanel />);
    expect(host.textContent).toMatch(/Strategy: Permanent portfolio/);
    await ask("explain this strategy");
    expect(host.textContent).toMatch(/Annual rebalance|equal weights|first trading day of each year/);
    act(() => useWorkspace.setState({ tabs: [{ id: "CC:_", code: "CC" }], activeTabId: "CC:_" }));
    expect(host.textContent).not.toMatch(/Strategy: Permanent portfolio/);
  });

  it("is hidden when closed", () => {
    useCopilot.setState({ open: false });
    render(<CopilotPanel />);
    expect(host.innerHTML).toBe("");
  });
});

describe("My Portfolio screen", () => {
  it("explains how to start when nothing is saved", () => {
    render(<PORT />);
    expect(host.textContent).toMatch(/No saved plans yet/);
    expect(host.textContent).toMatch(/Paper plans/);
    expect(host.textContent).toMatch(/Manually reported/);
  });

  it("shows a manual record with its label and a legible price failure", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    usePortfolios.getState().createPortfolio({ name: "Real ISA", mode: "manual", opening: [{ date: "2024-01-02", kind: "contribution", amount: 500, fee: 0 }] });
    await act(async () => { render(<PORT />); await new Promise((r) => setTimeout(r, 20)); });
    expect(host.textContent).toMatch(/Real ISA/);
    expect(host.textContent).toMatch(/not broker-verified/);
    expect(host.textContent).toMatch(/Holdings only/);
    await act(async () => { button("Ledger")!.click(); });
    expect(host.textContent).toMatch(/Contribution/);
    expect(host.textContent).toMatch(/\$500\.00/);
  });
});
