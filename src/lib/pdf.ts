// lib/pdf.ts
// Node-safe PDF text extraction using pdfjs-dist legacy build (avoids DOMMatrix/browser APIs)

export async function extractTextFromPdfBytes(bytes: Uint8Array): Promise<string> {
  // ✅ Dynamic import so Next doesn't evaluate pdfjs at bundle/module load time
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const getDocument =
    pdfjs.getDocument ?? pdfjs.default?.getDocument;

  if (typeof getDocument !== "function") {
    throw new Error(
      "pdfjs-dist legacy build did not expose getDocument(). Check pdfjs-dist version.",
    );
  }

  const loadingTask = getDocument({
    data: bytes,
    disableWorker: true, // serverless/Next route friendly
  });

  try {
    const doc = await loadingTask.promise;

    let out = "";
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();

      out += content.items
        .map((item: any) => (typeof item?.str === "string" ? item.str : ""))
        .join(" ")
        .trim();

      out += "\n";
    }

    return out.trim();
  } finally {
    // pdf.js recommends destroying the loading task
    await loadingTask.destroy?.().catch(() => undefined);
  }
}
