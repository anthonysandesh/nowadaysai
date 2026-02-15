import path from "node:path";
import { pathToFileURL } from "node:url";

import { PDFParse } from "pdf-parse";

let workerConfigured = false;

function ensurePdfWorkerConfigured() {
  if (workerConfigured) {
    return;
  }

  const workerFsPath = path.resolve(
    process.cwd(),
    "node_modules",
    "pdf-parse",
    "dist",
    "worker",
    "pdf.worker.mjs",
  );

  PDFParse.setWorker(pathToFileURL(workerFsPath).toString());
  workerConfigured = true;
}

export async function extractTextFromPdfBytes(bytes: Uint8Array): Promise<string> {
  ensurePdfWorkerConfigured();

  const parser = new PDFParse({ data: bytes });

  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
