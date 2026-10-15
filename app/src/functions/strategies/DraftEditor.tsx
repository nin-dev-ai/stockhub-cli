import { useMemo, useState } from "react";
import { validateStrategy, type StrategyDef } from "@/quant/strategy";
import { describeRules } from "@/quant/rules";

interface Props {
  initial: StrategyDef;
  /** Id of the curated original, shown so the user knows the original is unchanged. */
  forkOf?: string;
  onSave: (d: StrategyDef) => void;
  onCancel: () => void;
}

export function DraftEditor({ initial, forkOf, onSave, onCancel }: Props) {
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));

  const parsed = useMemo(() => {
    try {
      const obj = JSON.parse(text);
      const v = validateStrategy(obj);
      return { obj: obj as StrategyDef, errors: v.errors, syntax: null as string | null };
    } catch (e) {
      return { obj: null, errors: [] as string[], syntax: (e as Error).message };
    }
  }, [text]);

  const ok = parsed.obj != null && parsed.errors.length === 0;
  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <div className="text-term-muted text-[11px]">
        {forkOf ? <>Editing a copy of <span className="text-term-amber">{forkOf}</span>; the curated original is unchanged. </> : null}
        Edit parameters in the definition below. It must validate before it can be saved. Drafts stay in this browser.
      </div>
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
        className="w-full h-72 bg-term-bg border border-term-border text-term-text text-[11px] p-2 font-mono focus:outline-none focus:border-term-amberDim"
      />
      {parsed.syntax && <div className="text-term-red text-[11px]">JSON error: {parsed.syntax}</div>}
      {parsed.errors.length > 0 && (
        <ul className="text-term-red text-[11px] list-disc pl-4">{parsed.errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      {ok && (
        <div className="border border-term-borderSoft p-2">
          <div className="sub-header mb-1">Plain-English rules (generated from the definition)</div>
          <ul className="text-[11px] text-term-text list-disc pl-4 space-y-0.5">{describeRules(parsed.obj!).map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      <div className="flex gap-2">
        <button disabled={!ok} onClick={() => ok && onSave(parsed.obj!)}
          className="px-3 py-1 border border-term-amber text-term-amber hover:bg-term-amberSubtle disabled:opacity-30 disabled:cursor-not-allowed">
          Save draft
        </button>
        <button onClick={onCancel} className="px-3 py-1 border border-term-border text-term-muted hover:text-term-text">Cancel</button>
      </div>
    </div>
  );
}
