import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Badge } from "@/components/quant/Badges";
import { respond, suggestions, type Answer } from "@/copilot/assistant";
import { useCopilotContext, type CopilotContext } from "@/copilot/context";
import { useCopilot } from "@/copilot/copilotStore";
import { diffStrategy } from "@/copilot/drafting";
import { DraftEditor } from "@/functions/strategies/DraftEditor";
import { FN_BY_CODE } from "@/lib/functions";
import { allStrategies, useStrategies } from "@/store/strategyStore";
import { useWorkspace } from "@/store/workspaceStore";
import { usePersonas } from "@/store/personaStore";
import { useLab } from "@/store/labStore";
import { LAB_CHANGE_FIELDS, type LabChange } from "@/copilot/labChanges";
import { BuildPlan } from "@/functions/lab/BuildPlan";
import { eligible, LLM_ENABLED, LLM_MODEL, phrase } from "@/copilot/llm";

const fmtField = (k: keyof LabChange, v: unknown) =>
  k === "etf" ? String(v) : k === "alsoEtfs" ? ((v as string[] | undefined)?.join(", ") || "none") : k === "years" ? `${v} years` : `$${Number(v).toLocaleString("en-US")}`;

/** Shows current → proposed Lab inputs; nothing changes until Apply, and the Lab's Reset undoes it. */
function LabChangeCard({ change }: { change: LabChange }) {
  const { inputs, setInputs } = useLab();
  const openTab = useWorkspace((s) => s.openTab);
  const [applied, setApplied] = useState(false);
  // clearing a spread that is not set is no change worth a row
  const keys = (Object.keys(change) as (keyof LabChange)[]).filter((k) => k !== "alsoEtfs" || (change.alsoEtfs?.length ?? 0) > 0 || inputs.alsoEtfs.length > 0);
  if (applied) return <div className="text-[10px] text-term-green">Applied to the Lab inputs. Run the backtest again to see the effect.</div>;
  return (
    <div className="border border-term-amberDim p-2 flex flex-col gap-2">
      <div className="flex items-center gap-2"><span className="sub-header">Lab inputs</span><Badge tone="amber">Needs your confirmation</Badge></div>
      <table className="w-full grid-data text-[10px]">
        <thead><tr><th>Input</th><th>Now</th><th>Proposed</th></tr></thead>
        <tbody>{keys.map((k) => (
          <tr key={k}><td>{LAB_CHANGE_FIELDS[k]}</td><td className="num">{fmtField(k, inputs[k])}</td><td className="num text-term-amber">{fmtField(k, change[k])}</td></tr>
        ))}</tbody>
      </table>
      <div className="flex gap-2">
        <button onClick={() => { setInputs(change); setApplied(true); openTab("LAB"); }}
          className="px-2 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle text-[11px]">Apply to Lab</button>
      </div>
    </div>
  );
}

/**
 * "Build me a plan": nothing is tested until the user asks, then the plan engine's proposal appears
 * with Use this plan. Applying replaces the basket and weights and can be undone from this card.
 */
function PlanProposalCard({ fallLimit }: { fallLimit: number | null }) {
  const { inputs, setInputs, override, setOverride } = useLab();
  const { basket, setBasket } = useStrategies();
  const openTab = useWorkspace((s) => s.openTab);
  const [stage, setStage] = useState<"idle" | "testing" | "applied" | "undone">("idle");
  const [prev, setPrev] = useState<{ basket: string[]; override: typeof override; fall: number } | null>(null);
  const limit = fallLimit ?? inputs.fallLimit;
  if (stage === "undone") return <div className="text-[10px] text-term-green">Restored your previous plan.</div>;
  if (stage === "applied") {
    return (
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-term-green">Applied. The Lab's Plan tab shows it.</span>
        <button onClick={() => { if (prev) { setBasket(prev.basket); setOverride(prev.override); setInputs({ fallLimit: prev.fall }); } setStage("undone"); }}
          className="px-2 py-0.5 border border-term-border text-term-muted hover:text-term-amber uppercase tracking-widest">Undo</button>
      </div>
    );
  }
  if (stage === "idle") {
    return (
      <div className="flex flex-col gap-1">
        <button onClick={() => setStage("testing")} className="self-start px-2 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle text-[11px]">Test the catalog and propose a plan ({(limit * 100).toFixed(0)}% limit)</button>
      </div>
    );
  }
  return (
    <BuildPlan inputs={inputs} fallLimit={limit} onClose={() => setStage("idle")}
      onApply={(ids, weights) => {
        setPrev({ basket, override, fall: inputs.fallLimit });
        setBasket(ids); setOverride(weights); setInputs({ fallLimit: limit });
        setStage("applied"); openTab("LAB");
      }} />
  );
}

/** Following changes only what the Personas screen shows; it still needs the user's click. */
function PersonaCard({ answer }: { answer: Answer }) {
  const { followed, follow } = usePersonas();
  const openTab = useWorkspace((s) => s.openTab);
  const [done, setDone] = useState<string | null>(null);
  const { known } = answer.persona!;
  if (done) return <div className="text-[10px] text-term-green">{done}</div>;
  const btn = "px-2 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle text-[11px]";
  return (
    <div className="border border-term-amberDim p-2 flex flex-wrap items-center gap-2">
      {known && !followed.includes(known.id) && <Badge tone="amber">Needs your confirmation</Badge>}
      {known && !followed.includes(known.id)
        ? <button onClick={() => { follow(known.id); setDone(`Following ${known.name}. Opened the Personas screen.`); openTab("PERS"); }} className={btn}>Follow {known.name}</button>
        : <button onClick={() => { setDone("Opened the Personas screen."); openTab("PERS"); }} className={btn}>Open Personas</button>}
    </div>
  );
}

function DraftCard({ answer, onSaved }: { answer: Answer; onSaved: (name: string) => void }) {
  const saveDraft = useStrategies((s) => s.saveDraft);
  const [state, setState] = useState<"open" | "saved" | "dismissed">("open");
  const res = answer.draft!;
  const def = res.def!;
  const diff = diffStrategy(res.base, def);
  if (state === "dismissed") return <div className="text-[10px] text-term-muted">Draft discarded.</div>;
  if (state === "saved") return <div className="text-[10px] text-term-green">Saved as a draft.</div>;
  return (
    <div className="border border-term-amberDim p-2 flex flex-col gap-2">
      <div className="flex items-center gap-2"><span className="sub-header">Proposed definition</span><Badge tone="amber">Needs your confirmation</Badge></div>
      {res.base && diff.length > 0 && (
        <div>
          <div className="text-[10px] text-term-muted mb-1">{def.forkOf ? `Changes from ${res.base.name}` : `Compared with the curated ${res.base.name}`}</div>
          <table className="w-full grid-data text-[10px]">
            <thead><tr><th>Field</th><th>{def.forkOf ? "Before" : "Curated"}</th><th>Draft</th></tr></thead>
            <tbody>{diff.map((d) => <tr key={d.path}><td>{d.path}</td><td className="num">{d.before}</td><td className="num text-term-amber">{d.after}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <DraftEditor initial={def} forkOf={def.forkOf}
        onSave={(d) => { saveDraft(d); setState("saved"); onSaved(d.name); }} onCancel={() => setState("dismissed")} />
    </div>
  );
}

function AnswerView({ a, onSaved }: { a: Answer; onSaved: (name: string) => void }) {
  const openTab = useWorkspace((s) => s.openTab);
  const [showGrounded, setShowGrounded] = useState(false);
  const ph = a.phrasing;
  const blocks = ph?.status === "done" && showGrounded ? ph.grounded : a.blocks;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-term-amber text-[11px] font-bold">{a.title}</span>
        {a.verified && a.kind !== "glossary" && a.kind !== "help" && a.kind !== "refusal" && (
          <Badge tone="green" title="Every number in this answer was formatted from an engine result on screen or a vetted source.">Figures traced to engine</Badge>
        )}
        {!a.verified && <Badge tone="red">Withheld</Badge>}
        {ph?.status === "pending" && <Badge title="Claude is rephrasing the computed answer; the figures will be checked again.">Phrasing…</Badge>}
        {ph?.status === "done" && <Badge tone="cyan" title={`Rephrased by ${ph.model}. Every number was checked against the computed answer.`}>Phrased by Claude · figures checked</Badge>}
        {ph?.status === "fallback" && <Badge title={ph.reason}>Rule-based wording</Badge>}
      </div>
      {blocks.map((b, i) => b.type === "p" ? <p key={i} className="text-term-text leading-relaxed">{b.text}</p>
        : b.type === "note" ? <p key={i} className="text-term-muted text-[10px] leading-snug">{b.text}</p>
        : <ul key={i} className="list-disc pl-4 space-y-0.5 text-term-text">{b.items.map((x) => <li key={x}>{x}</li>)}</ul>)}
      {ph?.status === "done" && (
        <button onClick={() => setShowGrounded((v) => !v)} className="self-start text-[10px] text-term-muted hover:text-term-amber uppercase tracking-widest">
          {showGrounded ? "Show Claude's wording" : "Show the computed answer"}
        </button>
      )}
      {a.draft?.def && <DraftCard answer={a} onSaved={onSaved} />}
      {a.persona && <PersonaCard answer={a} />}
      {a.labChange && <LabChangeCard change={a.labChange} />}
      {a.planProposal && <PlanProposalCard fallLimit={a.planProposal.fallLimit} />}
      {a.open && <button onClick={() => openTab(a.open!.code)} className="self-start px-2 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle text-[11px]">{a.open.label}</button>}
      {a.sources.length > 0 && (
        <div className="text-[10px] text-term-muted border-t border-term-borderSoft pt-1">
          Sources: {a.sources.map((s, i) => <span key={i}>{i > 0 && " · "}{s.label}{s.detail ? ` (${s.detail})` : ""}</span>)}
        </div>
      )}
    </div>
  );
}

export function CopilotPanel() {
  const { open, setOpen, messages, push, update, clear } = useCopilot();
  const { strategy, lab, portfolio, personas } = useCopilotContext();
  const { tabs, activeTabId, openTab } = useWorkspace();
  const drafts = useStrategies((s) => s.drafts);
  const screen = tabs.find((t) => t.id === activeTabId)?.code ?? null;
  // only the active screen's results are in scope
  const ctx: CopilotContext = useMemo(() => ({
    screen,
    strategy: screen === "STRAT" ? strategy : null,
    lab: screen === "LAB" ? lab : null,
    portfolio: screen === "PORT" ? portfolio : null,
    personas: screen === "PERS" ? personas : null,
  }), [screen, strategy, lab, portfolio, personas]);
  const [input, setInput] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  if (!open) return null;

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    push({ role: "user", text });
    const answer = respond(text, ctx, { takenIds: allStrategies(drafts).map((d) => d.id) });
    const useLlm = LLM_ENABLED && eligible(answer);
    const id = push({ role: "assistant", answer: useLlm ? { ...answer, phrasing: { status: "pending" } } : answer });
    setInput("");
    if (useLlm) {
      void phrase(text, answer).then((r) => update(id, r.ok
        ? { ...answer, blocks: r.blocks, phrasing: { status: "done", model: r.model, grounded: answer.blocks } }
        : { ...answer, phrasing: { status: "fallback", reason: r.reason } }));
    }
  };
  const chips = [
    FN_BY_CODE[screen ?? ""]?.name,
    ctx.strategy && `Strategy: ${ctx.strategy.def.name}`,
    ctx.lab?.backtests.length ? "Backtest" : null,
    ctx.lab?.optimization ? "Optimization" : null,
    ctx.lab?.projection ? "Projection" : null,
    ctx.portfolio && `Portfolio: ${ctx.portfolio.name}`,
    ctx.personas?.personas.length ? `Personas: ${ctx.personas.personas.length} followed` : null,
  ].filter(Boolean) as string[];

  return (
    <aside aria-label="Copilot" className="w-[360px] shrink-0 ml-1 border border-term-border bg-term-panel flex flex-col min-h-0 text-[11px]">
      <div className="px-3 py-2 border-b border-term-border flex items-center gap-2">
        <Sparkles size={13} className="text-term-amber" />
        <span className="text-term-amber text-[11px] tracking-[0.22em] font-bold">COPILOT</span>
        <button onClick={clear} className="ml-auto text-[10px] text-term-muted hover:text-term-amber uppercase tracking-widest">Clear</button>
        <button onClick={() => setOpen(false)} aria-label="Close Copilot"><X size={14} className="text-term-muted hover:text-term-red" /></button>
      </div>
      <div className="px-3 py-1.5 border-b border-term-borderSoft flex flex-wrap gap-1 items-center">
        <span className="text-[10px] text-term-muted">Can see:</span>
        {chips.map((c) => <Badge key={c}>{c}</Badge>)}
      </div>
      <div className="flex-1 overflow-auto scroll-thin p-3 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="text-term-muted leading-relaxed">
            Ask about a concept, a strategy's rules, or a result on this screen. I explain what the engine calculated and never invent figures, place orders or change your plan.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "self-end max-w-[85%] border border-term-border bg-term-panel2 px-2 py-1 text-term-heading" : m.role === "system" ? "text-[10px] text-term-green" : ""}>
            {m.text}
            {m.answer && <AnswerView a={m.answer} onSaved={(name) => push({ role: "system", text: `Saved "${name}" to My drafts on the Strategies screen. Backtest it there before using it in a plan.` })} />}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="px-3 py-1.5 border-t border-term-borderSoft flex flex-wrap gap-1">
        {suggestions(ctx).map((s) => (
          <button key={s} onClick={() => ask(s)} className="text-left px-1.5 py-0.5 border border-term-border text-[10px] text-term-muted hover:text-term-amber hover:border-term-amberDim">{s}</button>
        ))}
        {messages.some((m) => m.role === "system") && <button onClick={() => openTab("STRAT")} className="px-1.5 py-0.5 border border-term-amberDim text-[10px] text-term-amber">Open Strategies</button>}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="p-2 border-t border-term-border flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask, or describe a strategy idea…" aria-label="Ask the Copilot"
          className="flex-1 bg-term-bg border border-term-border px-2 py-1 text-[11px] focus:outline-none focus:border-term-amberDim" />
        <button type="submit" className="px-2 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle uppercase tracking-widest text-[10px]">Ask</button>
      </form>
      <div className="px-3 pb-1.5 text-[9px] text-term-muted">{LLM_ENABLED
        ? `Answers are computed by StockHub and phrased by ${LLM_MODEL}; every figure is checked against the computed answer. Informational, not advice.`
        : "Rule-based assistant; no external AI service. Informational, not advice."}</div>
    </aside>
  );
}

export function CopilotToggle() {
  const { open, toggle } = useCopilot();
  return (
    <button onClick={toggle} aria-pressed={open} title="Explanations and strategy drafting"
      className={`ml-auto px-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.22em] border-l border-term-border ${open ? "text-term-amber bg-term-amberSubtle" : "text-term-muted hover:text-term-text hover:bg-term-panel2"}`}>
      <Sparkles size={12} /> Copilot
    </button>
  );
}
