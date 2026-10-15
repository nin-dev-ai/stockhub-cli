import { useWorkspace } from "@/store/workspaceStore";
import { sectionOf, type FunctionCode, type Section } from "@/lib/functions";
import { cn } from "@/lib/cn";
import { CopilotToggle } from "@/components/CopilotPanel";

interface Item { section: Section; label: string; hint: string; code: FunctionCode }

const ITEMS: Item[] = [
  { section: "explore", label: "Explore", hint: "Markets, instruments, charts", code: "CC" },
  { section: "strategies", label: "Strategies", hint: "Rules-based ideas with evidence", code: "STRAT" },
  { section: "lab", label: "Simulation Lab", hint: "Backtest, optimize and project a plan", code: "LAB" },
  { section: "portfolio", label: "My Portfolio", hint: "Saved plans, holdings and plan vs observed", code: "PORT" },
];

export function PrimaryNav() {
  const { tabs, activeTabId, openTab, setActiveTab } = useWorkspace();
  const active = tabs.find((t) => t.id === activeTabId);
  const current: Section = active ? sectionOf(active.code) : "explore";

  const go = (item: Item) => {
    // return to a tab already open in that section before creating a new one
    const existing = tabs.find((t) => sectionOf(t.code) === item.section);
    if (existing) setActiveTab(existing.id);
    else openTab(item.code);
  };

  return (
    <nav className="flex items-stretch h-8 bg-term-panel border-b border-term-border">
      {ITEMS.map((item) => (
        <button
          key={item.section}
          onClick={() => go(item)}
          title={item.hint}
          className={cn(
            "px-5 text-[11px] font-bold uppercase tracking-[0.22em] border-r border-term-border transition-colors",
            current === item.section
              ? "text-term-amber bg-term-amberSubtle border-b-2 border-b-term-amber"
              : "text-term-muted hover:text-term-text hover:bg-term-panel2",
          )}
        >
          {item.label}
        </button>
      ))}
      <CopilotToggle />
    </nav>
  );
}
