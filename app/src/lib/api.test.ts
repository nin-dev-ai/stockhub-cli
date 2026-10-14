import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchNewsCompany, fetchQuote, ApiError } from "./api";

const respond = (status: number, body?: unknown) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "status",
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  }));

afterEach(() => vi.unstubAllGlobals());

describe("api get()", () => {
  it("treats 204 No Content as an empty result instead of undefined", async () => {
    respond(204);
    await expect(fetchNewsCompany("TSLA")).resolves.toEqual([]);
  });

  it("returns body.results on success", async () => {
    respond(200, { results: [{ symbol: "AAPL", last_price: 1 }] });
    await expect(fetchQuote("AAPL")).resolves.toEqual({ symbol: "AAPL", last_price: 1 });
  });

  it("throws ApiError carrying the missing credential name", async () => {
    respond(401, { detail: "Missing credential 'fmp_api_key'." });
    const err = await fetchNewsCompany("AAPL").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(err.needsKey).toBe("fmp_api_key");
  });

  it("joins validation error messages from array details", async () => {
    respond(422, { detail: [{ msg: "bad symbol" }, { msg: "bad limit" }] });
    const err = await fetchNewsCompany("AAPL").catch((e) => e);
    expect(err.message).toBe("bad symbol; bad limit");
  });
});
