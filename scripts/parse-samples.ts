import fs from "node:fs";
import path from "node:path";

import { PDFParse } from "pdf-parse";

import { parseQuoteContent, parseQuoteText } from "../src/lib/quote-parser";
import { enrichFromMarriottLinks } from "../src/lib/marriott-enrichment";
import { emptyParsedFields, QUOTE_FIELD_ORDER } from "../src/lib/quote-types";

async function extractPdfText(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function mergeMissingFields(
  primary: ReturnType<typeof parseQuoteText>,
  fallback: ReturnType<typeof parseQuoteText>,
) {
  const mergedFields = emptyParsedFields();

  for (const fieldKey of QUOTE_FIELD_ORDER) {
    mergedFields[fieldKey] =
      primary.fields[fieldKey].value !== null ? primary.fields[fieldKey] : fallback.fields[fieldKey];
  }

  const hasAnyField = QUOTE_FIELD_ORDER.some((fieldKey) => mergedFields[fieldKey].value !== null);
  const warnings = hasAnyField
    ? primary.warnings.filter((warning) => warning !== "No required totals were detected in this input.")
    : primary.warnings;

  return {
    fields: mergedFields,
    warnings,
    normalizedText: primary.normalizedText,
  };
}

async function run() {
  const sampleDir = path.resolve(process.cwd(), "..", "email samples provided");
  const files = fs.readdirSync(sampleDir).sort();

  for (const fileName of files) {
    const filePath = path.join(sampleDir, fileName);
    const lower = fileName.toLowerCase();
    let parsed;
    let sourceTexts: string[];

    if (lower.endsWith(".pdf")) {
      const pdfText = await extractPdfText(filePath);
      parsed = parseQuoteText(pdfText);
      sourceTexts = [pdfText];
    } else {
      const rawText = fs.readFileSync(filePath, "utf8");
      parsed = parseQuoteContent(rawText, "auto");
      sourceTexts = [rawText, parsed.normalizedText];
    }

    const enrichment = await enrichFromMarriottLinks(sourceTexts);
    if (enrichment.enrichment) {
      parsed = mergeMissingFields(parsed, enrichment.enrichment.parsed);
    }

    console.log(`\n===== ${fileName} =====`);

    for (const key of QUOTE_FIELD_ORDER) {
      const field = parsed.fields[key];
      console.log(`${field.label}: ${field.displayValue ?? "Not found"}`);
    }

    if (parsed.warnings.length > 0) {
      console.log(`Warnings: ${parsed.warnings.join(" | ")}`);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
