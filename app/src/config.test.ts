import { describe, it, expect } from "vitest";
import { defines, featureLines, proxyTable, readEnv, SEC_CONTACT_HEADER, secUserAgent, validSecContact } from "../stockhub.config";

describe("local server configuration", () => {
  it("takes the SEC contact from the environment, else from a valid contact the browser sent, else refuses", () => {
    const off = readEnv({});
    const on = readEnv({ STOCKHUB_SEC_CONTACT: "Jane Doe jane@example.com" });
    expect(secUserAgent(on, "Someone Else x@y.com")).toBe("StockHub/1 (Jane Doe jane@example.com)");
    expect(secUserAgent(off, "Sam Lee sam@example.com")).toBe("StockHub/1 (Sam Lee sam@example.com)");
    expect(secUserAgent(off, ["Sam Lee sam@example.com"])).toBe("StockHub/1 (Sam Lee sam@example.com)");
    expect(secUserAgent(off, undefined)).toBeNull();
    for (const bad of ["no email here", "a@b", "Sam\r\nX-Evil: 1 sam@example.com", "x".repeat(130) + " a@b.co", ""]) expect(validSecContact(bad), bad).toBeNull();
    // the route always exists; without any contact it answers 404 locally
    const bypass = proxyTable(off)["/sec/data"].bypass!;
    expect(bypass({ headers: {} } as never, undefined as never, {} as never)).toBe(false);
    expect(bypass({ headers: { [SEC_CONTACT_HEADER]: "Sam Lee sam@example.com" } } as never, undefined as never, {} as never)).toBeUndefined();
  });

  it("turns optional features on only with their settings, and keeps secrets out of the browser flags", () => {
    const off = readEnv({});
    expect(Object.keys(proxyTable(off))).not.toContain("/llm/v1/messages");
    const on = readEnv({ STOCKHUB_SEC_CONTACT: " Jane Doe jane@example.com ", STOCKHUB_LLM_KEY: "sk-secret", IBKR_GATEWAY_URL: "https://localhost:5001" });
    expect(on.secUa).toBe("StockHub/1 (Jane Doe jane@example.com)");
    const table = proxyTable(on);
    expect(table["/sec/data"].headers).toEqual({ "User-Agent": "StockHub/1 (Jane Doe jane@example.com)" });
    expect((table["/llm/v1/messages"].headers as Record<string, string>)["x-api-key"]).toBe("sk-secret");
    expect(table["/ibkr"]).toMatchObject({ target: "https://localhost:5001", secure: false });
    const flags = JSON.stringify(defines(on));
    expect(flags).not.toContain("sk-secret");
    expect(flags).not.toContain("jane@example.com");
    expect(featureLines(on).join("\n")).toMatch(/Live SEC filings: on/);
    expect(featureLines(off).join("\n")).toMatch(/Claude wording for the Copilot: off/);
  });
  it("has no proxy prefix that begins another one (Vite matches by prefix)", () => {
    const keys = Object.keys(proxyTable(readEnv({ STOCKHUB_SEC_CONTACT: "x x@y.z", STOCKHUB_LLM_KEY: "k" })));
    for (const a of keys) for (const b of keys) if (a !== b) expect(b.startsWith(a) && b[a.length] !== "/", `${a} is a prefix of ${b}`).toBe(false);
    // and none of them swallows another route's path segment-wise either
    for (const a of keys) for (const b of keys) if (a !== b) expect(b.startsWith(`${a}/`), `${a} would capture ${b}`).toBe(false);
  });
  it("rewrites each route to the upstream path", () => {
    const t = proxyTable(readEnv({ STOCKHUB_SEC_CONTACT: "x x@y.z" }));
    const rw = (k: string, p: string) => (t[k].rewrite ? t[k].rewrite!(p) : p);
    expect(rw("/clerk", "/clerk/public_disc/x.zip")).toBe("/public_disc/x.zip");
    expect(rw("/ark-api", "/ark-api/api/v2/etf/trades")).toBe("/api/v2/etf/trades");
    expect(rw("/rss/yahoo", "/rss/yahoo?s=AAPL")).toBe("/rss/2.0/headline?s=AAPL");
    expect(rw("/sec/www", "/sec/www/Archives/edgar/data/1/2/doc.xml")).toBe("/Archives/edgar/data/1/2/doc.xml");
  });
});
