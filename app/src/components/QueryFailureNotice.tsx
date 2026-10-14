import type { UseQueryResult } from "@tanstack/react-query";

interface Props {
  label: string;
  queries: UseQueryResult<unknown, Error>[];
}

export function QueryFailureNotice({ label, queries }: Props) {
  const failed = queries.filter((q) => q.isError);
  if (failed.length === 0) return null;
  const first = failed[0].error?.message ?? "Request failed";
  return (
    <div role="alert" className="border border-term-red/40 bg-term-red/5 px-3 py-2 text-term-text text-[12px]">
      {failed.length === queries.length
        ? `${label} data is unavailable.`
        : `${failed.length} of ${queries.length} ${label} requests failed; affected values show — and the view is incomplete.`}
      <span className="ml-2 text-term-muted">{first}</span>
      <button className="ml-3 text-term-amber hover:underline" onClick={() => failed.forEach((q) => void q.refetch())}>
        Retry
      </button>
    </div>
  );
}
