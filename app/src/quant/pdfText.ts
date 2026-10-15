import type { TextItem } from "./congress";

type PdfJs = typeof import("pdfjs-dist");

/** Positioned text runs of every page of a PDF; empty pages (scanned images) give empty lists. */
export async function pdfTextItems(data: Uint8Array, pdfjs: PdfJs): Promise<TextItem[][]> {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages: TextItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.flatMap((it) => ("str" in it && it.str.trim() ? [{ str: it.str, x: it.transform[4], y: it.transform[5] }] : [])));
  }
  await doc.destroy();
  return pages;
}
