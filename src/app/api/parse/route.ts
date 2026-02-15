import { NextResponse } from "next/server";

export const runtime = "nodejs"
import {
  parseQuoteContent,
  parseQuoteText,
  RawContentFormat,
} from "@/lib/quote-parser";
import type { ParseQuoteOutput } from "@/lib/quote-parser";
import { enrichFromMarriottLinks } from "@/lib/marriott-enrichment";
import { extractTextFromPdfBytes } from "@/lib/pdf";
import {
  emptyParsedFields,
  ParseApiResponse,
  ParsedQuoteResult,
  QUOTE_FIELD_ORDER,
} from "@/lib/quote-types";
import { isSupabaseConfigured, saveParsedQuote } from "@/lib/supabase";

export const runtime = "nodejs";
const NO_TOTALS_WARNING = "No required totals were detected in this input.";

interface ParsedSource {
  output: ParseQuoteOutput;
  sourceTexts: string[];
}

function inferFormatFromFile(file: File): RawContentFormat {
  const fileName = file.name.toLowerCase();
  const mime = file.type.toLowerCase();

  if (fileName.endsWith(".html") || fileName.endsWith(".htm") || mime.includes("html")) {
    return "html";
  }

  return "text";
}

async function extractPdfText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return extractTextFromPdfBytes(bytes);
}

function hasDetectedAnyField(output: ParseQuoteOutput): boolean {
  return QUOTE_FIELD_ORDER.some((fieldKey) => output.fields[fieldKey].value !== null);
}

function mergeMissingFields(primary: ParseQuoteOutput, fallback: ParseQuoteOutput): ParseQuoteOutput {
  const mergedFields = emptyParsedFields();

  for (const fieldKey of QUOTE_FIELD_ORDER) {
    mergedFields[fieldKey] =
      primary.fields[fieldKey].value !== null ? primary.fields[fieldKey] : fallback.fields[fieldKey];
  }

  const mergedWarnings = hasDetectedAnyField({ ...primary, fields: mergedFields })
    ? primary.warnings.filter((warning) => warning !== NO_TOTALS_WARNING)
    : primary.warnings;

  return {
    fields: mergedFields,
    warnings: mergedWarnings,
    normalizedText: primary.normalizedText,
  };
}

async function applyLinkedProposalEnrichment(
  output: ParseQuoteOutput,
  sourceTexts: string[],
): Promise<{ output: ParseQuoteOutput; extraWarnings: string[] }> {
  const enrichmentResult = await enrichFromMarriottLinks(sourceTexts);

  if (!enrichmentResult.enrichment) {
    return {
      output,
      extraWarnings: enrichmentResult.warning ? [enrichmentResult.warning] : [],
    };
  }

  const mergedOutput = mergeMissingFields(output, enrichmentResult.enrichment.parsed);
  const addedField = QUOTE_FIELD_ORDER.some(
    (fieldKey) =>
      output.fields[fieldKey].value === null && mergedOutput.fields[fieldKey].value !== null,
  );

  if (!addedField) {
    return {
      output,
      extraWarnings: [],
    };
  }

  return {
    output: mergedOutput,
    extraWarnings: [
      `Enriched missing totals from linked Marriott proposal (${enrichmentResult.enrichment.proposalId}).`,
    ],
  };
}

async function parseUploadedFile(file: File): Promise<ParsedSource> {
  const lowerName = file.name.toLowerCase();
  const isPdf = lowerName.endsWith(".pdf") || file.type.toLowerCase().includes("pdf");

  if (isPdf) {
    const pdfText = await extractPdfText(file);
    return {
      output: parseQuoteText(pdfText),
      sourceTexts: [pdfText],
    };
  }

  const rawText = await file.text();
  const output = parseQuoteContent(rawText, inferFormatFromFile(file));

  return {
    output,
    sourceTexts: [rawText, output.normalizedText],
  };
}

export async function POST(request: Request) {
  const formData = await request.formData();

  const pastedContent = String(formData.get("pastedContent") ?? "");
  const pastedFormat =
    (String(formData.get("pastedFormat") ?? "auto") as RawContentFormat) ?? "auto";
  const fileInputs = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!pastedContent.trim() && fileInputs.length === 0) {
    return NextResponse.json(
      {
        error: "Add pasted content or upload at least one file.",
      },
      { status: 400 },
    );
  }

  const supabaseConfigured = isSupabaseConfigured();
  const results: ParsedQuoteResult[] = [];

  const buildResult = async (
    sourceName: string,
    sourceType: "pasted" | "file",
    output: ParseQuoteOutput,
    extraWarnings: string[] = [],
  ): Promise<ParsedQuoteResult> => {
    const normalizedTextPreview = output.normalizedText.slice(0, 1500);
    const warnings = [...new Set([...output.warnings, ...extraWarnings])];

    if (!supabaseConfigured) {
      return {
        sourceName,
        sourceType,
        fields: output.fields,
        warnings,
        normalizedTextPreview,
        saved: false,
        savedError: null,
        recordId: null,
      };
    }

    const saved = await saveParsedQuote({
      sourceName,
      sourceType,
      fields: output.fields,
      normalizedTextPreview,
    });

    return {
      sourceName,
      sourceType,
      fields: output.fields,
      warnings,
      normalizedTextPreview,
      saved: saved.saved,
      savedError: saved.error,
      recordId: saved.recordId,
    };
  };

  if (pastedContent.trim()) {
    const parsed = parseQuoteContent(pastedContent, pastedFormat);
    const enriched = await applyLinkedProposalEnrichment(parsed, [pastedContent, parsed.normalizedText]);
    results.push(await buildResult("Pasted Content", "pasted", enriched.output, enriched.extraWarnings));
  }

  for (const file of fileInputs) {
    try {
      const parsedSource = await parseUploadedFile(file);
      const enriched = await applyLinkedProposalEnrichment(
        parsedSource.output,
        parsedSource.sourceTexts,
      );
      results.push(await buildResult(file.name, "file", enriched.output, enriched.extraWarnings));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown parse error";
      results.push({
        sourceName: file.name,
        sourceType: "file",
        fields: emptyParsedFields(),
        warnings: [
          "Failed to parse this file.",
          `Reason: ${errorMessage}`,
          "Try copying the quote text directly into the paste field.",
        ],
        normalizedTextPreview: "",
        saved: false,
        savedError: null,
        recordId: null,
      });
    }
  }

  const payload: ParseApiResponse = {
    results,
    supabaseConfigured,
  };

  return NextResponse.json(payload);
}
