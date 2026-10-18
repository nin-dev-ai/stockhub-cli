import { fmtMoney, fmtRate } from "@/lib/format";
import { buyListSummary, type BuyList } from "@/quant/buyList";

/** Whole shares per ETF for an amount, leftover cash and the gap from target, as Paper Orders would buy them. */
export function BuyListTable({ list, title }: { list: BuyList; title: string }) {
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <div className="sub-header">{title}</div>
      <div className={list.zero.length ? "text-term-amberBright" : "text-term-text"}>{buyListSummary(list)}</div>
      <table className="w-full grid-data">
        <thead><tr><th>ETF</th><th className="text-right">Target</th><th className="text-right">Price</th><th className="text-right">Whole shares</th><th className="text-right">Cost</th><th className="text-right">Weight</th><th className="text-right">Gap</th></tr></thead>
        <tbody>
          {list.rows.map((r) => (
            <tr key={r.ticker} className={r.shares === 0 ? "text-term-muted" : ""}>
              <td>{r.ticker}</td><td className="num text-right">{fmtRate(r.target)}</td><td className="num text-right">{fmtMoney(r.price, 2)}</td>
              <td className="num text-right">{r.shares}</td><td className="num text-right">{fmtMoney(r.cost, 2)}</td>
              <td className="num text-right">{fmtRate(r.weight)}</td><td className="num text-right">{(r.gap * 100).toFixed(1)} pts</td>
            </tr>
          ))}
          <tr><td>Cash left</td><td /><td /><td /><td className="num text-right">{fmtMoney(list.leftover, 2)}</td><td className="num text-right">{fmtRate(list.amount > 0 ? list.leftover / list.amount : null)}</td><td /></tr>
        </tbody>
      </table>
      {list.unpriced.length > 0 && <div className="text-term-muted">No price for {list.unpriced.join(", ")}; left out.</div>}
      <div className="text-[10px] text-term-muted">Each ETF gets the whole shares that fit inside its target share, rounded down, the way Paper Orders sizes purchases. Prices are the latest close in the data.</div>
    </div>
  );
}
