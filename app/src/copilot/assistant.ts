import { CATALOG } from "@/quant/catalog";
import { OBJECTIVES } from "@/quant/optimizer";
import { describeRules } from "@/quant/rules";
import { MODE_LABEL } from "@/quant/tracking";
import { HOUSE_NOTE } from "@/quant/congress";
import { FUND_NOTE, POLITICIAN_NOTE, PRESET_PERSONAS, UNAVAILABLE_PEOPLE, type Persona } from "@/quant/personas";
import { requiredTickers, type StrategyDef } from "@/quant/strategy";
import type { CopilotContext, LabContext, PersonaEntry, PersonasContext, PortfolioContext, StrategyContext } from "./context";
import { LAB_CHANGE_FIELDS, labChangeFromText, type LabChange } from "./labChanges";
import { draftFromText, findTickers, modifyFromText, variantFromText, type DraftResult } from "./drafting";
import { findTerms, GLOSSARY_BY_ID, type GlossaryEntry } from "./glossary";
import { classifyGuard, hasUnsafeCertainty, verifyFigures, type GuardKind } from "./guardrails";

/**
 * The Copilot: a deterministic, tool-mediated assistant (decision 7). Every figure it states is
 * formatted from a structured engine result through the Composer, which records it as a
 * permitted source; the final text is then checked so no other number can appear (AI-06).
 */

export type Block = { type: "p"; text: string } | { type: "list"; items: string[] } | { type: "note"; text: string };
export interface Source { label: string; detail?: string }
export type AnswerKind = "lab_change" | "persona" | "glossary" | "strategy" | "backtest" | "optimization" | "projection" | "portfolio" | "methodology" | "draft" | "refusal" | "help";

export interface Answer {
  kind: AnswerKind;
  title: string;
  blocks: Block[];
  sources: Source[];
  draft?: DraftResult;
  /** A persona to follow, offered for confirmation; `known: null` offers to open the Personas screen. */
  persona?: { known: Persona | null };
  /** Proposed Lab inputs, applied only when the user clicks Apply. */
  labChange?: LabChange;
  /** A screen the user may open with one click (permission level 1). */
  open?: { code: "ORD" | "PORT"; label: string };
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
  /** Text shown verbatim from a filing or provider (an issuer name), registered so its digits pass verification. */
  data = (s: string) => this.reg(s);
  /** Static product text and generated rule text; numbers inside are vetted, not computed. */
  vetted = (s: string) => this.reg(s);

  p(text: string) { this.blocks.push({ type: "p", text }); return this; }
  list(items: string[]) { if (items.length) this.blocks.push({ type: "list", items }); return this; }
  note(text: string) { this.blocks.push({ type: "note", text }); return this; }
  source(label: string, detail?: string) { this.sources.push({ label, detail }); return this; }

  persona?: { known: Persona | null };
  /** Proposed Lab inputs, applied only when the user clicks Apply. */
  labChange?: LabChange;
  open?: { code: "ORD" | "PORT"; label: string };

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
    return { kind: this.kind, title: this.title, blocks: this.blocks, sources: this.sources, draft, persona: this.persona, labChange: this.labChange, open: this.open, verified: true, unverified: [] };
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

  // proposed changes to Lab inputs (permission level 1): ETF, starting amount, contribution, horizon
  const labWords = /\b(lab|plan|simulation|simulate|contribut\w*|starting amount|start with|initial|lump[- ]sum|horizon|per month|a month|monthly)\b/i;
  if (has(m, labWords) && has(m, /\b(set|change|make|use|run|try|switch|increase|decrease|raise|lower|put|update|invest|start|with)\b/i)) {
    const lc = labChangeFromText(m);
    if (Object.keys(lc.change).length > 0) return labChange(m, lc);
  }

  // opening the paper-orders or broker screens is level 1; sending orders never is
  if (has(m, /\b(ibkr|interactive brokers|broker|paper (account|orders?|trading)|orders? screen)\b/i) && !has(m, /\b(place|submit|execute|send)\b/i)) {
    const orders = has(m, /\b(orders?|rebalanc\w*|trade|trading)\b/i);
    const c = new Composer("help", orders ? "Paper orders" : "Interactive Brokers", m);
    if (orders) {
      c.p("The Paper Orders screen proposes whole-share orders that move an IBKR paper account toward a saved plan's targets. You preview each order with IBKR, confirm it, and answer any question IBKR asks yourself; I cannot send, confirm or cancel orders.");
      c.list(["Paper accounts only; live accounts are refused.", "Only StockHub's supported ETFs, long only, market or limit orders.", "A per-order cap, a daily cap, a kill switch and an audit log."]);
      c.open = { code: "ORD", label: "Open Paper Orders" };
    } else {
      c.p("My Portfolio reads an Interactive Brokers account through IBKR's Client Portal Gateway running on your computer: balances and positions, read-only. Sync adds the positions to a broker-reported portfolio so it can be compared with a plan.");
      c.open = { code: "PORT", label: "Open My Portfolio" };
    }
    c.source("Copilot permissions", "PRD 6.6.1: open a screen (level 1); never trade (level 3)");
    return c.done();
  }

  // the copy-trade backtest open on the Personas screen (level 0: explain what is on screen)
  if (ctx.screen === "PERS" && has(m, /\b(cop(y|ied|ying)|mirror(ed|ing)?)\b/i) && has(m, /\b(what if|had|would|result|backtest|explain|how|did|lag|delay)\b/i)) {
    if (ctx.personas?.copy) return copyResult(m, ctx.personas.copy);
    const c = new Composer("persona", "Copy-trade backtest", m);
    c.p("Open a House member's card on this screen and choose Backtest copying. It runs their reported purchases and sales twice, from the day each report was filed and from the trade date, against SPY, and I can then explain the result.");
    c.note("Copying is a historical test only; StockHub places no orders.");
    return c.done();
  }

  if (ctx.personas?.personas.length && ctx.screen === "PERS") {
    const words = m.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/);
    const one = ctx.personas.personas.find((p) => words.includes(p.name.toLowerCase().split(" ").pop()!));
    if (one) return personaTrades(m, [one]);
    if (has(m, /\b(explain|summari[sz]e|overview|what|who|which|why|these|this|trades?|buying|selling|bought|sold)\b/i) && !personaRequest(m)?.politician) {
      return personaTrades(m, ctx.personas.personas);
    }
  }

  const who = personaRequest(m);
  if (who) return persona(m, who);

  const wantsDraft = has(m, /\b(create|build|draft|make|write|design|turn|convert)\b.{0,50}\b(strategy|rule|plan)\b/i) || has(m, /^\s*(strategy|draft|idea)\s*:/i);
  const wantsEdit = !!ctx.strategy && has(m, /\b(change|make it|use an?|switch|set|instead|increase|decrease|try|tweak|modify)\b/i) && !wantsDraft;
  // "run the golden cross on QQQ", "apply this to the Nasdaq", "use BIL instead of SHY"
  const variantBase = wantsDraft ? null : namedStrategy(m) ?? ctx.strategy?.def ?? null;
  if (variantBase && has(m, /\b(run|apply|use|try|test|put|switch|move|replace|swap)\b/i)
    && (has(m, /\binstead of\b|\b(replace|swap)\b/i) || findTickers(m).some((t) => !requiredTickers(variantBase).includes(t)))) {
    return variant(m, variantBase);
  }
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
      "Paper-account orders to Interactive Brokers can only be sent by you, one confirmed order at a time, from the Paper Orders screen (ORD). Live accounts are refused.",
    ]);
    c.open = { code: "ORD", label: "Open Paper Orders" };
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
  if (pf.mode === "broker") c.note("These holdings were synced from Interactive Brokers through a read-only connection. Deposits are not visible, so holdings that appeared between syncs count as money in; I cannot place or change orders.");
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
  c.p(edit ? `A copy of ${c.vetted(curatedName(ctx.strategy!.def))} with these changes. The original is not modified.` : "Here is how I read your idea. Nothing is saved or run until you confirm.");
  c.list(res.understood.map(c.vetted));
  if (res.assumptions.length) { c.p("Defaults I filled in:"); c.list(res.assumptions.map(c.vetted)); }
  if (res.unsupported.length) { c.p("Not supported, so left out:"); c.list(res.unsupported.map(c.vetted)); }
  if (res.errors.length) c.note(`The draft does not validate yet: ${c.vetted(res.errors.join(" "))} Edit the definition below.`);
  c.note("Review the definition and the generated rules, then save it as a draft. Backtest it from the Strategies screen; it carries no evidence until you do.");
  c.source("Strategy schema", "version 1 validation");
  return c.done(res);
}

const PERSONA_VERB = /\b(follow|track|watch|monitor|mirror|copy|persona|trades?|trading|bought|sold|buying|selling|doing|portfolio|positions?)\b/i;
const TITLE = "(?:rep\\.?|representative|senator|sen\\.?|congress(?:wo)?man|speaker)";

/** A preset persona named in the message, a politician (no public feed), or a new name after "follow". */
export function personaRequest(m: string): { known: Persona | null; name: string; politician?: boolean } | null {
  if (!PERSONA_VERB.test(m)) return null;
  const words = m.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/);
  const known = PRESET_PERSONAS.find((p) => words.includes(p.name.toLowerCase().split(" ").pop()!));
  if (known) return { known, name: known.name };
  const pol = Object.keys(UNAVAILABLE_PEOPLE).find((k) => words.includes(k));
  if (pol) return { known: null, name: UNAVAILABLE_PEOPLE[pol], politician: true };
  if (/\b(congress|senators?|politicians?|representatives?)\b/i.test(m)) return { known: null, name: "members of Congress", politician: true };
  // verbs and titles in any case; the name itself must be capitalized
  const ci = (w: string) => w.replace(/[a-z]/, (ch) => `[${ch}${ch.toUpperCase()}]`);
  const verbs = ["follow", "track", "watch", "monitor", "mirror", "copy", "following", "persona for", "persona of", "persona following"].map(ci).join("|");
  const re = new RegExp(`\\b(?:${verbs})\\s+(?:${TITLE.replace(/[a-z]+/g, (w) => ci(w))}\\s+)?([A-Z][a-z'-]+(?:\\s+[A-Z][a-z'-]+){1,2})`);
  const hit = re.exec(m);
  return hit ? { known: null, name: hit[1] } : null;
}

function persona(m: string, who: { known: Persona | null; name: string; politician?: boolean }): Answer {
  const c = new Composer("persona", who.politician ? "Not available from a public source" : `Follow ${who.name}`, m);
  const p = who.known;
  if (who.politician) {
    c.p(c.vetted(POLITICIAN_NOTE));
    c.p(c.vetted(`Personas that can be followed are people whose trades are in free official filings: fund managers through 13F (${PRESET_PERSONAS.filter((x) => x.source.kind === "fund").map((x) => x.name).join(", ")}), corporate insiders through Form 4 (${PRESET_PERSONAS.filter((x) => x.source.kind === "insider").map((x) => x.name).join(", ")}), and US House members through their Periodic Transaction Reports (${PRESET_PERSONAS.filter((x) => x.source.kind === "house").map((x) => x.name).join(", ")}, or any member found by name on the Personas screen).`));
  } else if (p?.source.kind === "fund") {
    c.p(c.vetted(`${p.name}'s persona reads ${p.source.firm}'s Form 13F filings from SEC EDGAR and shows what changed between the latest two quarters: new positions, additions, trims and full sales, with share changes, value and portfolio weight.`));
    c.note(c.vetted(FUND_NOTE));
  } else if (p?.source.kind === "house") {
    c.p(c.vetted(`${p.name}'s persona reads their Periodic Transaction Reports from the Clerk of the House (filed this year or last): each trade's date, filing date, owner, asset and amount range, with a link to the report.`));
    c.note(c.vetted(HOUSE_NOTE));
  } else if (p?.source.kind === "insider") {
    c.p(c.vetted(`${p.name}'s persona reads the Form 4 filings for ${p.source.company} from SEC EDGAR: each trade's date, shares, price and value, with a link to the filing. Insiders file within two business days, so these are the freshest public trades.`));
    c.note(c.vetted("Grants, option exercises, tax withholding and gifts are hidden by default; the Personas screen can show them."));
  } else {
    c.p(c.vetted(`${who.name} is not a preset. Add them on the Personas screen: a fund manager by their firm's CIK (13F), a company insider by the company's ticker and their name (Form 4), or a US House member by name or district.`));
  }
  if (p?.note) c.note(c.vetted(p.note));
  if (/\b(mirror|copy)\b/i.test(m)) c.note(c.vetted("Copying trades automatically is not supported: StockHub is not connected to a broker and places no orders. Following is for research."));
  c.persona = { known: p };
  if (p?.source.kind === "house") c.source("Clerk of the House", "Periodic Transaction Reports, no key");
  else c.source("SEC EDGAR", "Form 13F and Form 4 via OpenBB, no key");
  return c.done();
}

function labChange(m: string, lc: ReturnType<typeof labChangeFromText>): Answer {
  const c = new Composer("lab_change", "Proposed change to your Lab inputs", m);
  c.p("Here is what I read. Nothing changes until you click Apply; the Lab's Reset button restores the defaults.");
  c.list(lc.understood.map(c.vetted));
  if (lc.errors.length) c.note(`This change is outside the allowed range: ${c.vetted(lc.errors.join(" "))}`);
  else c.labChange = lc.change;
  c.note(c.vetted(`Only ${Object.values(LAB_CHANGE_FIELDS).join(", ").toLowerCase()} can be changed from here. Costs, risk settings, weights and saved plans stay under your direct control.`));
  c.note("Run the backtest and projection again after applying; earlier results are kept, not overwritten.");
  return c.done();
}

/** Explains the copy-trade backtest on screen; every figure comes from the two engine runs. */
function copyResult(m: string, k: NonNullable<NonNullable<CopilotContext["personas"]>["copy"]>): Answer {
  const c = new Composer("persona", `Copying ${k.name}: backtest`, m);
  c.p(`Starting with ${c.money(k.initial)} on ${c.date(k.start)} and ending ${c.date(k.end)}, copying ${c.data(k.name)}'s reported purchases and sales in equal weights:`);
  c.list([
    `Acting when each report was filed: ${c.money(k.filed.finalValue)} (${c.pct(k.filed.totalReturn)} total return, worst drawdown ${c.pct(k.filed.maxDrawdown)}).`,
    `Acting on the trade dates, which no copier could do: ${c.money(k.traded.finalValue)} (${c.pct(k.traded.totalReturn)}).`,
    `${c.data(k.benchmark.ticker)} buy and hold: ${c.money(k.benchmark.finalValue)} (${c.pct(k.benchmark.totalReturn)}).`,
  ]);
  c.p(k.lagCost >= 0
    ? `The reporting delay cost ${c.money(k.lagCost)}${k.medianLagDays != null ? `; the median report came ${c.int(k.medianLagDays)} days after the trade` : ""}.`
    : `Here the delay happened to help by ${c.money(-k.lagCost)}${k.medianLagDays != null ? ` (median delay ${c.int(k.medianLagDays)} days)` : ""}; it can as easily hurt.`);
  if (k.unpriced.length || k.skipped.length) c.note(`Left out for lack of prices or a ticker: ${[...k.unpriced, ...k.skipped].map(c.data).join(", ")}.`);
  c.note("Amounts are ranges, so the copy uses equal weights, and option trades are copied as stock exposure. A short window is weak evidence, and this is a historical test, not a recommendation.");
  c.source("StockHub engine", "copy-trade backtest on the Personas screen");
  c.source("Clerk of the House", "Periodic Transaction Reports");
  return c.done();
}

/** Explains trades the Personas screen has loaded; every figure comes from those rows. */
function personaTrades(m: string, entries: PersonaEntry[]): Answer {
  const c = new Composer("persona", entries.length === 1 ? `${entries[0].name}: loaded trades` : "Followed personas: loaded trades", m);
  const qtr = (d: string | null) => (d ? c.date(`Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1} ${d.slice(0, 4)}`) : "an unknown quarter");
  const items: string[] = [];
  for (const e of entries) {
    if (e.loading) { items.push(`${e.name}: still loading.`); continue; }
    if (e.error) { items.push(`${e.name}: the filings could not be loaded.`); continue; }
    const buys = e.trades.filter((t) => t.side === "buy"), sells = e.trades.filter((t) => t.side === "sell");
    const top = [...e.trades].sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0)).slice(0, 3)
      .map((t) => `${c.data(t.symbol ?? t.asset)} (${t.action.toLowerCase()}${t.value ? `, ${c.money(t.value)}` : ""})`);
    if (e.kind === "fund") {
      if (!e.prior) { items.push(`${e.name}: only one quarter is filed, so there are no changes to compare.`); continue; }
      items.push(`${e.name}: from ${qtr(e.prior)} to ${qtr(e.latest)}, ${c.int(buys.length)} new or added positions and ${c.int(sells.length)} trimmed or sold, out of ${c.int(e.holdings ?? 0)} holdings. Largest by value: ${top.join(", ") || "none"}.`);
    } else if (e.kind === "house") {
      if (e.trades.length === 0) { items.push(`${e.name}: no purchases or sales in the reports read.`); continue; }
      const last = [...e.trades].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
      const names = [...new Map(e.trades.filter((t) => t.symbol).map((t) => [t.symbol!, t])).keys()].slice(0, 5).map(c.data);
      items.push(`${e.name}: ${c.int(buys.length)} purchases and ${c.int(sells.length)} sales in the reports read${names.length ? `, in ${names.join(", ")}` : ""}. Latest: ${last.action.toLowerCase()} of ${c.data(last.symbol ?? last.asset)}${last.amount ? ` (${c.data(last.amount)})` : ""} on ${c.date(last.date ?? "")}, filed ${c.date(last.filed ?? "")}.`);
    } else if (e.trades.length === 0) {
      items.push(`${e.name}: no open-market buys or sells in the filings loaded.`);
    } else {
      const last = [...e.trades].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
      items.push(`${e.name}: ${c.int(buys.length)} buys and ${c.int(sells.length)} sells in the filings loaded. Latest: ${last.action.toLowerCase()} of ${c.int(Math.round(Math.abs(last.shares ?? 0)))} shares${last.price ? ` at ${c.money(last.price)}` : ""} on ${c.date(last.date ?? "")}.`);
    }
  }
  c.list(items);
  if (entries.some((e) => e.kind === "fund")) c.note(c.vetted(FUND_NOTE));
  if (entries.some((e) => e.kind === "house")) c.note(c.vetted(HOUSE_NOTE));
  c.note("These are filed trades, not recommendations, and they say nothing about why the person traded.");
  if (entries.some((e) => e.kind !== "house")) c.source("SEC EDGAR", "filings loaded on the Personas screen");
  if (entries.some((e) => e.kind === "house")) c.source("Clerk of the House", "reports loaded on the Personas screen");
  return c.done();
}

/** Curated names are product text and may be quoted; a user draft's free-text name is not. */
const curatedName = (d: StrategyDef) => (CATALOG.some((s) => s.id === d.id && s.name === d.name) ? d.name : "your draft");

function variant(m: string, base: StrategyDef): Answer {
  const res = variantFromText(m, base);
  const c = new Composer("draft", "Same rules, different ETFs", m);
  if (!res.def) {
    c.note(c.vetted(res.errors.join(" ")));
    if (res.unsupported.length) c.list(res.unsupported.map(c.vetted));
    return c.done(res);
  }
  c.p(`A copy of ${c.vetted(curatedName(base))} that runs on other ETFs. The original is not modified, and nothing is saved until you confirm.`);
  c.list(res.understood.map(c.vetted));
  c.p("Assumptions:");
  c.list(res.assumptions.map(c.vetted));
  if (res.unsupported.length) { c.p("Left out:"); c.list(res.unsupported.map(c.vetted)); }
  if (res.errors.length) c.note(`The variant does not validate: ${c.vetted(res.errors.join(" "))}`);
  c.note("After saving, it appears under My drafts on the Strategies screen with its own backtest. The sidebar's Test against ETFs switch does the same for every strategy at once.");
  c.source("Strategy schema", "retarget, version 1 validation");
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
  if (ctx.screen === "STRAT" && ctx.strategy) out.push("Explain this strategy's rules and risks", "Run this on QQQ", "Make it rebalance annually");
  if (ctx.screen === "LAB" && ctx.lab) {
    if (ctx.lab.optimization) out.push("Why did the optimizer choose these weights?");
    if (ctx.lab.projection) out.push("Explain my projection range");
    if (!ctx.lab.optimization && !ctx.lab.projection) out.push("Explain the backtest results");
  }
  if (ctx.screen === "PORT" && ctx.portfolio) out.push("Why is my portfolio different from the plan?");
  if (ctx.screen === "PERS" && ctx.personas?.personas.length) out.push("Summarize these trades");
  if (ctx.screen === "LAB") out.push("Run my plan on QQQ with $500 a month for 10 years");
  out.push("Run the golden cross on the Nasdaq", "Follow Warren Buffett's trades", "What is a Sharpe ratio?", "Create a strategy: hold SPY above its 200-day moving average, otherwise bonds");
  return [...new Set(out)].slice(0, 5);
}
