import { CATALOG } from "@/quant/catalog";
import { OBJECTIVES } from "@/quant/optimizer";
import { describeRules } from "@/quant/rules";
import { MODE_LABEL } from "@/quant/tracking";
import type { StrategyDef } from "@/quant/strategy";
import type { CopilotContext, LabContext, PortfolioContext, StrategyContext } from "./context";
import { draftFromText, modifyFromText, type DraftResult } from "./drafting";
import { findTerms, GLOSSARY_BY_ID, type GlossaryEntry } from "./glossary";
import { classifyGuard, hasUnsafeCertainty, verifyFigures, type GuardKind } from "./guardrails";

/**
 * The Copilot: a deterministic, tool-mediated assistant (decision 7). Every figure it states is
 * formatted from a structured engine result through the Composer, which records it as a
 * permitted source; the final text is then checked so no other number can appear (AI-06).
 */

export type Block = { type: "p"; text: string } | { type: "list"; items: string[] } | { type: "note"; text: string };
export interface Source { label: string; detail?: string }
export type AnswerKind = "glossary" | "strategy" | "backtest" | "optimization" | "projection" | "portfolio" | "methodology" | "draft" | "refusal" | "help";

export interface Answer {
  kind: AnswerKind;
  title: string;
  blocks: Block[];
  sources: Source[];
  draft?: DraftResult;
  verified: boolean;
  unverified: string[];
}

class Composer {
  blocks: Block[] = [];
  sources: Source[] = [];
  permitted: string[] = [];
  constructor(public kind: AnswerKind, public title: string, userMessage: string) { this.permitted.push(userMessage, STATIC_FIGURES); }

  private reg(s: string) { this.permitted.push(s); return s; }
  pct = (x: number | null | undefined, d = 1) => (x == null ? "unavailable" : this.reg(`${(x * 100).toFixed(d)}%`));
  pts = (x: number | null | undefined, d = 1) => (x == null ? "unavailable" : this.reg(`${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)} points`));
  money = (x: number | null | undefined) => (x == null ? "unavailable" : this.reg(`${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { maximumFractionDigits: 0 })}`));
  ratio = (x: number | null | undefined, d = 2) => (x == null ? "unavailable" : this.reg(x.toFixed(d)));
  int = (x: number) => this.reg(x.toLocaleString("en-US"));
  date = (s: string) => this.reg(s);
  /** Static product text and generated rule text; numbers inside are vetted, not computed. */
  vetted = (s: string) => this.reg(s);

  p(text: string) { this.blocks.push({ type: "p", text }); return this; }
  list(items: string[]) { if (items.length) this.blocks.push({ type: "list", items }); return this; }
  note(text: string) { this.blocks.push({ type: "note", text }); return this; }
  source(label: string, detail?: string) { this.sources.push({ label, detail }); return this; }

  done(draft?: DraftResult): Answer {
    const text = this.blocks.map((b) => (b.type === "list" ? b.items.join("\n") : b.text)).join("\n");
    const check = verifyFigures(text, this.permitted);
    const unsafe = this.kind !== "refusal" && hasUnsafeCertainty(text);
    if (!check.ok || unsafe) {
      return {
        kind: "refusal", title: "Answer withheld", sources: this.sources, verified: false, unverified: check.unverified,
        blocks: [{ type: "note", text: unsafe
          ? "The drafted answer used certainty language that StockHub does not allow, so it was withheld."
          : "The drafted answer contained figures that could not be traced to an engine result or a vetted source, so it was withheld rather than risk showing an invented number." }],
      };
    }
    return { kind: this.kind, title: this.title, blocks: this.blocks, sources: this.sources, draft, verified: true, unverified: [] };
  }
}

const has = (m: string, re: RegExp) => re.test(m);
/** Fixed product vocabulary that contains digits but is not a result: percentile names and their meaning. */
const STATIC_FIGURES = "10th 50th 90th 10th–90th 1 in 10 1 in 5";
const DISCLAIMER = "Informational only, not personal advice. Past results and simulations do not predict future returns.";

// ---------------------------------------------------------------------------------------------

export function respond(message: string, ctx: CopilotContext, opts: { takenIds?: string[] } = {}): Answer {
  const m = message.trim();
  if (!m) return help(m, ctx);

  const guard = classifyGuard(m);
  if (guard) return refuse(guard, m, ctx);

  const wantsDraft = has(m, /\b(create|build|draft|make|write|design|turn|convert)\b.{0,50}\b(strategy|rule|plan)\b/i) || has(m, /^\s*(strategy|draft|idea)\s*:/i);
  const wantsEdit = !!ctx.strategy && has(m, /\b(change|make it|use an?|switch|set|instead|increase|decrease|try|tweak|modify)\b/i) && !wantsDraft;
  if (wantsDraft || wantsEdit) return draft(m, ctx, wantsEdit, opts.takenIds ?? []);

  const terms = findTerms(m);
  const definitional = has(m, /^\s*(what('?s| is| are| does)|define|meaning of|explain the term|tell me about)\b/i);
  const aboutResults = has(m, /\b(this|my|these|the current|our|here|result|results)\b/i);
  if (definitional && terms.length > 0 && !aboutResults) return glossary(m, terms);

  const screen = ctx.screen;
  if (has(m, /\b(portfolio|tracking|behind|ahead|attribution|observed|reforecast|on track|off track|snapshot)\b/i) || (screen === "PORT" && has(m, /\b(explain|why|difference|this)\b/i))) return portfolio(m, ctx.portfolio);
  if (has(m, /\b(weights?|allocation|optimi[sz](e|ed|er|ation)|binding|constraints?|cap)\b/i)) return optimization(m, ctx.lab);
  if (has(m, /\b(projection|projected|fan|percentiles?|range|outcomes?|scenarios?|chance|probability|future)\b/i)) return projection(m, ctx.lab);
  const named = namedStrategy(m);
  if (has(m, /\b(backtest|performed|perform|did it do|historical|history|past results?|track record)\b/i)) {
    const s = named ? { def: named, result: null, draft: false } : ctx.strategy;
    if (s && (screen !== "LAB" || named)) return strategy(m, s, true);
    return backtest(m, ctx.lab);
  }
  if (named || (ctx.strategy && has(m, /\b(explain|how does|how do|what does|rules?|why|risks?|caveats?|evidence|strategy|this)\b/i))) {
    return strategy(m, named ? { def: named, result: ctx.strategy?.def.id === named.id ? ctx.strategy.result : null, draft: false } : ctx.strategy!, false);
  }
  if (has(m, /\b(data|source|sources|methodology|method|assumptions?|calculated|computed|where .* from)\b/i)) return methodology(m, ctx);
  if (terms.length > 0) return glossary(m, terms);
  if (screen === "LAB" && ctx.lab && has(m, /\b(explain|summari[sz]e|results?|this)\b/i)) return labSummary(m, ctx.lab);
  return help(m, ctx);
}

/** A catalog strategy named in the message, matched on its id or most of the distinctive words in its name. */
export function namedStrategy(m: string): StrategyDef | null {
  const t = m.toLowerCase();
  for (const s of CATALOG) if (t.includes(s.id)) return s;
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !["with", "hold", "buy", "and", "stocks", "bonds", "etfs", "across"].includes(w));
  let best: { s: StrategyDef; score: number } | null = null;
  for (const s of CATALOG) {
    const ws = words(s.name);
    const hit = ws.filter((w) => t.includes(w)).length;
    const score = ws.length ? hit / ws.length : 0;
    if (hit >= 2 && score >= 0.5 && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? null;
}

// ---------------------------------------------------------------------------------------------

function refuse(kind: GuardKind, m: string, ctx: CopilotContext): Answer {
  const c = new Composer("refusal", "", m);
  if (kind === "injection") {
    c.title = "Request not followed";
    c.p("I only follow StockHub's rules. Text that asks me to ignore them, whether typed here or found in a strategy description, is treated as data and not as an instruction.");
    c.p("I can explain a concept, a strategy's rules, or a result already calculated by the engine.");
  } else if (kind === "action") {
    c.title = "I cannot take actions";
    c.p("I can explain and draft, but I never place orders, change a portfolio, edit assumptions or publish strategies. Those always need your own action.");
    c.list([
      "Change plan inputs or weights in the Simulation Lab's left pane or Allocation tab.",
      "Record contributions or trades on the My Portfolio Ledger tab; paper rebalances are previewed before you confirm them.",
      "StockHub has no broker connection and cannot execute real trades.",
    ]);
  } else if (kind === "certainty") {
    c.title = "No one can promise a result";
    c.p("I can't tell you what you will earn. Markets are uncertain, and StockHub's projections describe a range of model-based possibilities, not a forecast.");
    const p = ctx.lab?.projection;
    if (p?.ending) {
      c.p(`For the current Lab projection, ${c.vetted("1 in 10")} simulated paths ended below ${c.money(p.ending.p10)}, half ended below ${c.money(p.ending.p50)}, and ${c.vetted("1 in 10")} ended above ${c.money(p.ending.p90)} after ${c.int(p.input.years)} years. These depend on the method and history used, and real outcomes can fall outside the range.`);
      c.source("Projection engine", `${p.input.method}, seed ${p.input.seed}`);
    } else c.note("Run a projection in the Simulation Lab to see a range of outcomes for your plan.");
  } else {
    c.title = "Informational only";
    c.p("I can't recommend what you should buy or sell. I can explain how strategies work, what their historical tests showed, and what a simulation of your own plan suggests, so you can decide.");
    c.list(["Compare strategies' evidence and risks on the Strategies screen.", "Test a basket with your own amounts in the Simulation Lab."]);
  }
  c.note(DISCLAIMER);
  return c.done();
}

function glossary(m: string, terms: GlossaryEntry[]): Answer {
  const c = new Composer("glossary", terms.length === 1 ? terms[0].term : "Definitions", m);
  for (const t of terms.slice(0, 3)) {
    c.p(`${terms.length > 1 ? `${t.term}: ` : ""}${c.vetted(t.text)}`);
    c.source("StockHub glossary", t.term);
  }
  const related = terms.flatMap((t) => t.seeAlso ?? []).map((id) => GLOSSARY_BY_ID[id]?.term).filter(Boolean);
  if (related.length) c.note(`Related: ${[...new Set(related)].join(", ")}.`);
  return c.done();
}

function strategy(m: string, s: StrategyContext, focusEvidence: boolean): Answer {
  const d = s.def;
  const c = new Composer("strategy", d.name, m);
  if (s.draft) {
    c.p("This is your own draft. Its rules below are generated from its definition; its free-text description is not used as evidence.");
  } else {
    c.p(c.vetted(`${d.summary} ${d.intendedUse}`));
  }
  if (!focusEvidence || !s.result) {
    c.p("Exact rules, generated from the machine-readable definition:");
    c.list(describeRules(d).map(c.vetted));
  }
  c.source("Strategy definition", `${d.id} v${d.version}`);

  const r = s.result;
  if (r) {
    const x = r.run.metrics, b = r.benchmark.run.metrics;
    c.p(`Historical backtest from ${c.date(r.window.start)} to ${c.date(r.window.end)}: compound annual growth ${c.pct(x.cagr)} versus ${c.pct(b.cagr)} for ${r.benchmark.ticker} buy-and-hold, maximum drawdown ${c.pct(x.maxDrawdown)} versus ${c.pct(b.maxDrawdown)}, Sharpe ratio ${c.ratio(x.sharpe)} versus ${c.ratio(b.sharpe)}, with ${c.int(r.run.tradeCount)} trades.`);
    if (r.robustness) c.p(`Robustness verdict: ${r.robustness.verdict}. ${r.robustness.verdict === "consistent" ? "It held up across the checks in this sample, which is still not evidence about the future." : "Treat the backtest with extra caution."}`);
    const warn = r.flags.filter((f) => f.severity !== "info").map((f) => c.vetted(f.message));
    if (warn.length) { c.p("Data and quality warnings:"); c.list(warn); }
    c.source("Backtest engine", `run ${r.runId.slice(0, 8)} · dataset ${r.dataset.id.slice(0, 8)} · ${r.dataset.provider}`);
  } else {
    c.note("No backtest result for this strategy is on screen, so I am not quoting any performance figures. Open it on the Strategies screen to see its evidence.");
  }
  if (!s.draft) {
    c.p("Risks and caveats:");
    c.list(d.caveats.map(c.vetted));
  }
  if (d.experimental) c.note("Marked experimental: a good backtest is weak evidence for this rule.");
  c.note(`Evidence status: ${d.evidence}. Backtests use dividend-adjusted closes, decide on data through each close and trade at the next close.`);
  return c.done();
}

function backtest(m: string, lab: LabContext | null): Answer {
  const c = new Composer("backtest", "Historical backtest of your plan", m);
  if (!lab || lab.backtests.length === 0 || !lab.planMetrics) {
    c.note("No backtest has been run in the Simulation Lab yet, so there are no results to explain. Run Backtest first.");
    return c.done();
  }
  const pm = lab.planMetrics, first = lab.backtests[0];
  c.p(`Your blended plan from ${c.date(first.window.start)} to ${c.date(first.window.end)}: compound annual growth ${c.pct(pm.cagr)}, volatility ${c.pct(pm.volatility)}, maximum drawdown ${c.pct(pm.maxDrawdown)}, Sharpe ratio ${c.ratio(pm.sharpe)}.`);
  c.list(lab.backtests.map((b) => `${c.vetted(b.strategy.name)}: growth ${c.pct(b.run.metrics.cagr)}, maximum drawdown ${c.pct(b.run.metrics.maxDrawdown)}${lab.weights ? `, weight ${c.pct(lab.weights[b.strategy.id] ?? 0, 0)}` : ""}.`));
  c.p("Returns are time-weighted, so your contributions do not count as performance. Costs and slippage are deducted; taxes are not.");
  c.source("Backtest engine", `dataset ${first.dataset.id.slice(0, 8)} · ${first.dataset.provider}`);
  c.note(DISCLAIMER);
  return c.done();
}

function optimization(m: string, lab: LabContext | null): Answer {
  const c = new Composer("optimization", "Why these weights", m);
  const o = lab?.optimization;
  if (!lab || !o) {
    c.note("No optimization result is available. Run Optimize Allocation in the Simulation Lab, then ask again.");
    return c.done();
  }
  const obj = lab.inputs.objective;
  const prop = o.proposals[obj];
  const meta = OBJECTIVES.find((x) => x.key === obj)!;
  const names = Object.fromEntries(lab.backtests.map((b) => [b.strategy.id, b.strategy.name]));
  const eq = 1 / o.ids.length;
  c.p(`Objective: ${meta.label}. ${c.vetted(meta.description)} The search tried ${c.int(o.evaluated)} long-only weight combinations in ${c.vetted("1%")} steps with no leverage, each strategy capped at ${c.pct(o.effectiveCap, 0)}.`);
  c.p("Proposed weights compared with an equal split:");
  c.list(o.ids.map((id) => `${c.vetted(names[id] ?? id)}: ${c.pct(prop.weights[id], 0)} (${c.pts((prop.weights[id] ?? 0) - eq, 0)} versus equal weight)`));
  if (prop.binding.length) {
    c.p("Constraints that limited the result:");
    c.list(prop.binding.map((b) => b.kind === "cap"
      ? `${c.vetted(names[b.id] ?? b.id)} hit the ${c.pct(o.effectiveCap, 0)} cap; without the cap the optimizer would have wanted more of it.`
      : `${c.vetted(names[b.id] ?? b.id)} was set to zero: adding any of it worsened the objective in this sample.`));
  } else c.p("No constraint was binding: the weights are an interior solution for this objective.");
  const ew = o.baselines.find((b) => /equal/i.test(b.label));
  c.p(`Historical result of the proposal: volatility ${c.pct(prop.metrics.volatility)}, growth ${c.pct(prop.metrics.cagr)}, Sharpe ${c.ratio(prop.metrics.sharpe)}, maximum drawdown ${c.pct(prop.metrics.maxDrawdown)}.${ew ? ` Equal weight: volatility ${c.pct(ew.metrics.volatility)}, growth ${c.pct(ew.metrics.cagr)}, Sharpe ${c.ratio(ew.metrics.sharpe)}.` : ""}`);
  if (o.outOfSample) {
    const t = o.outOfSample;
    c.p(`Out-of-sample check: weights fitted on data before ${c.date(t.splitDate)} reached a Sharpe ratio of ${c.ratio(t.test.sharpe)} afterwards, versus ${c.ratio(t.equalWeightTest.sharpe)} for equal weight. ${(t.test.sharpe ?? -Infinity) > (t.equalWeightTest.sharpe ?? Infinity) ? "The optimization added value on unseen data in this test." : "It did not beat equal weight on unseen data, so treat the proposal's edge as uncertain."}`);
  }
  if (lab.weightsSource === "user override") c.note("You have overridden these weights; the Lab is using your weights, not the proposal.");
  c.list(o.notes.map(c.vetted));
  c.source("Optimizer", `${o.method} · run ${o.runId.slice(0, 8)} · ${o.window.start} → ${o.window.end}`);
  c.note("Weights are fitted to history; the best weights in the past are rarely the best in the future.");
  return c.done();
}

function projection(m: string, lab: LabContext | null): Answer {
  const c = new Composer("projection", "Your projection, explained", m);
  const p = lab?.projection;
  if (!p) {
    c.note("No projection has been run. Run Projection in the Simulation Lab to simulate a range of outcomes for your plan.");
    return c.done();
  }
  c.p(`Method: ${p.input.method === "bootstrap" ? `block bootstrap, resampling ${c.int(p.input.observations)} historical monthly returns in blocks of ${c.int(p.input.blockMonths)} months` : `parametric, drawing from a normal distribution fitted to ${c.int(p.input.observations)} monthly returns`}, ${c.int(p.input.paths)} paths, random seed ${c.int(p.input.seed)}. Data quality: ${p.quality}.`);
  if (p.ending) {
    c.p(`After ${c.int(p.input.years)} years, having put in ${c.money(p.totalContributed)}: the 10th percentile ending value is ${c.money(p.ending.p10)}, the median ${c.money(p.ending.p50)} and the 90th percentile ${c.money(p.ending.p90)}. In today's money the median is ${c.money(p.endingReal!.p50)}.`);
    c.p(`${c.pct(p.probLoss)} of simulated paths ended below the total contributed.${p.probGoal != null ? ` ${c.pct(p.probGoal)} reached your goal.` : ""}`);
    c.p("Stress scenarios (median ending value):");
    c.list(p.scenarios.map((s) => `${c.vetted(s.label)}: ${c.money(s.ending.p50)}. ${c.vetted(s.description)}`));
  }
  c.list(p.reasons.map(c.vetted));
  c.note("The 10th percentile is not a worst case and the 90th is not a maximum. The range is conditional on the method and history; real outcomes can fall outside it.");
  c.source("Projection engine", `run ${p.runId.slice(0, 8)} · engine ${p.engineVersion}`);
  return c.done();
}

function portfolio(m: string, pf: PortfolioContext | null): Answer {
  const c = new Composer("portfolio", "Plan versus observed", m);
  if (!pf) { c.note("Open a portfolio on the My Portfolio screen and I can explain how it compares with its saved plan."); return c.done(); }
  c.p(`${c.vetted(pf.name)} is ${MODE_LABEL[pf.mode].toLowerCase()}.${pf.total != null ? ` Current value ${c.money(pf.total)}, net contributed ${c.money(pf.contributed)}.` : ""}`);
  const a = pf.attribution;
  if (!a) { c.note(pf.snapshots === 0 ? "It has no saved plan, so there is no projection to compare with." : "Prices have not loaded yet, so no comparison is available."); return c.done(); }
  c.p(`After ${c.ratio(a.monthsElapsed, 1)} months the original plan's median was ${c.money(a.plan.p50)} and the observed value is ${c.money(a.observed)}, a gap of ${c.money(a.total)}. The observed value is ${a.band === "within" ? "inside" : a.band === "below" ? "below" : "above"} the plan's 10th–90th percentile range of ${c.money(a.plan.p10)} to ${c.money(a.plan.p90)}.`);
  c.p("The gap splits into:");
  c.list([
    `Contribution difference ${c.money(a.contributionDifference)}: you put in ${c.money(a.actualContributed)} against ${c.money(a.plan.contributed)} planned.`,
    a.projectionError == null ? "Projection error: unavailable without a plan replay." : `Projection error ${c.money(a.projectionError)}: the plan's realized return on your cash flows versus the median path.`,
    a.allocationDifference == null ? "Allocation difference: unavailable without a plan replay." : `Allocation and implementation ${c.money(a.allocationDifference)}: your actual holdings versus following the plan exactly.`,
    "FX: not applicable, as only USD instruments are supported.",
  ]);
  c.list(a.notes.filter((n) => !n.startsWith("FX")).map(c.vetted));
  if (pf.mode === "manual") c.note("These records are manually reported and not broker-verified.");
  c.source("Tracking engine", "saved snapshot, ledger and plan replay");
  return c.done();
}

function methodology(m: string, ctx: CopilotContext): Answer {
  const c = new Composer("methodology", "Data and methodology", m);
  c.p("Prices are daily closes adjusted for splits and dividends, loaded through the local OpenBB API from yfinance. Each dataset gets an id from a hash of its data, and quality checks flag gaps, stale prices, short histories and suspicious jumps.");
  c.p("Backtests decide on data through each close and fill at the next close after slippage and fees. Returns are time-weighted. Cash earns nothing, taxes are excluded, and only US-listed ETFs in USD are supported.");
  c.p("Projections resample historical monthly returns of the blended plan (or fit a normal distribution), with a fixed random seed so a run can be reproduced. They are not shown when fewer than five years of monthly history exist.");
  const r = ctx.lab?.backtests[0] ?? ctx.strategy?.result;
  if (r) c.p(`The data on screen runs from ${c.date(r.window.start)} to ${c.date(r.window.end)} and was fetched ${c.date(r.dataset.fetchedAt.slice(0, 10))}.`);
  else c.note("No result is on screen, so I can't cite a specific dataset.");
  c.source("Calculation report", "Simulation Lab › View Methodology");
  return c.done();
}

function labSummary(m: string, lab: LabContext): Answer {
  if (lab.projection) return projection(m, lab);
  if (lab.optimization) return optimization(m, lab);
  return backtest(m, lab);
}

function draft(m: string, ctx: CopilotContext, edit: boolean, takenIds: string[]): Answer {
  const res = edit && ctx.strategy ? modifyFromText(m, ctx.strategy.def, takenIds) : draftFromText(m, { takenIds });
  const c = new Composer("draft", edit ? "Proposed change" : "Proposed strategy draft", m);
  if (!res.def) {
    c.note(res.errors.join(" "));
    c.list(res.unsupported);
    return c.done(res);
  }
  c.p(edit ? `A copy of ${ctx.strategy!.def.name} with these changes. The original is not modified.` : "Here is how I read your idea. Nothing is saved or run until you confirm.");
  c.list(res.understood.map(c.vetted));
  if (res.assumptions.length) { c.p("Defaults I filled in:"); c.list(res.assumptions.map(c.vetted)); }
  if (res.unsupported.length) { c.p("Not supported, so left out:"); c.list(res.unsupported.map(c.vetted)); }
  if (res.errors.length) c.note(`The draft does not validate yet: ${c.vetted(res.errors.join(" "))} Edit the definition below.`);
  c.note("Review the definition and the generated rules, then save it as a draft. Backtest it from the Strategies screen; it carries no evidence until you do.");
  c.source("Strategy schema", "version 1 validation");
  return c.done(res);
}

function help(m: string, ctx: CopilotContext): Answer {
  const c = new Composer("help", "What I can help with", m);
  c.p("I explain concepts and the results StockHub's engine has calculated, and I can draft a strategy from a description. I never invent figures, place orders or change your plan.");
  c.list(suggestions(ctx));
  return c.done();
}

/** Prompts that fit the current screen and what it has calculated. */
export function suggestions(ctx: CopilotContext): string[] {
  const out: string[] = [];
  if (ctx.screen === "STRAT" && ctx.strategy) out.push("Explain this strategy's rules and risks", "Make it rebalance annually");
  if (ctx.screen === "LAB" && ctx.lab) {
    if (ctx.lab.optimization) out.push("Why did the optimizer choose these weights?");
    if (ctx.lab.projection) out.push("Explain my projection range");
    if (!ctx.lab.optimization && !ctx.lab.projection) out.push("Explain the backtest results");
  }
  if (ctx.screen === "PORT" && ctx.portfolio) out.push("Why is my portfolio different from the plan?");
  out.push("What is a Sharpe ratio?", "Create a strategy: hold SPY above its 200-day moving average, otherwise bonds");
  return [...new Set(out)].slice(0, 5);
}
