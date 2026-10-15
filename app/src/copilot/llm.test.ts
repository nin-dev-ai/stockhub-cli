import { describe, it, expect } from "vitest";
import { answerText, phrase, toBlocks, SYSTEM_PROMPT, LLM_ENABLED } from "./llm";
import type { Answer } from "./assistant";

const grounded: Answer = {
  kind: "persona", title: "Copying Nancy Pelosi: backtest", verified: true, unverified: [], sources: [{ label: "StockHub engine" }],
  blocks: [
    { type: "p", text: "Starting with $10,000 on 2024-12-20, copying her reported trades:" },
    { type: "list", items: ["Acting when each report was filed: $14,264 (42.6% total return).", "SPY buy and hold: $13,230 (32.3%)."] },
    { type: "note", text: "A short window is weak evidence." },
  ],
};
const llm = (text: string, status = 200) => {
  const seen: { body?: string } = {};
  const f = (async (_url: string, init?: RequestInit) => { seen.body = String(init?.body); return new Response(JSON.stringify({ model: "claude-test", content: [{ type: "text", text }] }), { status }); }) as unknown as typeof fetch;
  return { f, seen };
};

describe("LLM phrasing (E6)", () => {
  it("is off unless the dev server has a key", () => expect(LLM_ENABLED).toBe(false));
  it("sends only the message and the grounded answer, with data-not-instructions rules", async () => {
    const { f, seen } = llm("Copying her filed trades turned $10,000 into $14,264, a 42.6% return.\n\n- SPY did $13,230.");
    const r = await phrase("what if I copied Pelosi?", grounded, f, "claude-test");
    expect(r).toEqual({ ok: true, model: "claude-test", blocks: [{ type: "p", text: "Copying her filed trades turned $10,000 into $14,264, a 42.6% return." }, { type: "list", items: ["SPY did $13,230."] }] });
    const body = JSON.parse(seen.body!);
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.messages[0].content).toContain(answerText(grounded));
    expect(body.messages[0].content).toContain("USER MESSAGE:\nwhat if I copied Pelosi?");
    expect(body.tools).toBeUndefined();
  });
  it("falls back when the model invents a figure or uses certainty or buy/sell language", async () => {
    expect(await phrase("q", grounded, llm("It made $15,000.").f)).toMatchObject({ ok: false, reason: expect.stringMatching(/15000/) });
    expect(await phrase("q", grounded, llm("You should buy what she buys.").f)).toMatchObject({ ok: false, reason: expect.stringMatching(/certainty|buy\/sell/) });
    expect(await phrase("q", grounded, llm("This is guaranteed to work.").f)).toMatchObject({ ok: false });
    expect(await phrase("q", grounded, llm("", 500).f)).toMatchObject({ ok: false, reason: expect.stringMatching(/500/) });
  });
  it("never sends refusals or withheld answers", async () => {
    let called = false;
    const f = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
    expect((await phrase("buy 5 SPY", { ...grounded, kind: "refusal" }, f)).ok).toBe(false);
    expect((await phrase("q", { ...grounded, verified: false }, f)).ok).toBe(false);
    expect(called).toBe(false);
  });
  it("turns text back into paragraphs and lists", () => {
    expect(toBlocks("One.\nTwo.\n\n- a\n- b\n\n")).toEqual([{ type: "p", text: "One. Two." }, { type: "list", items: ["a", "b"] }]);
  });
});
