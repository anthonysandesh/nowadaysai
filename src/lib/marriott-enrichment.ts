import type { ParseQuoteOutput } from "@/lib/quote-parser";
import { toPlainText } from "@/lib/quote-parser";
import { emptyParsedFields, formatCurrency, QUOTE_FIELD_ORDER } from "@/lib/quote-types";

const MARRIOTT_PROPOSAL_ID_RE =
  /(?:https?:\/\/)?(?:[\w-]+\.)?bookmarriott\.com\/proposals\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

interface MarriottRoomBlock {
  Contracted?: unknown;
  RoomRate?: unknown;
}

interface MarriottQuoteFunction {
  NegotiatedRoomRental?: unknown;
  MinimumFoodRevenue?: unknown;
}

interface MarriottQuote {
  QuoteRoomBlock?: MarriottRoomBlock[];
  QuoteFunction?: MarriottQuoteFunction[];
}

interface MarriottChapter {
  title?: unknown;
  description?: unknown;
}

interface MarriottProposalResponse {
  data?: {
    options?: {
      ciData?: {
        Quote?: MarriottQuote[];
      };
    };
    chapters?: MarriottChapter[];
  };
}

interface MarriottTotals {
  guestroomTotal: number | null;
  meetingRoomTotal: number | null;
  foodAndBeverageTotal: number | null;
  totalQuote: number | null;
}

export interface MarriottProposalEnrichment {
  proposalId: string;
  parsed: ParseQuoteOutput;
}

export interface MarriottLinkEnrichmentResult {
  enrichment: MarriottProposalEnrichment | null;
  warning: string | null;
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseFloat(value.replace(/,/g, "").trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function formatAmount(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function extractGuestroomTotal(quote: MarriottQuote | undefined): number | null {
  const roomBlocks = Array.isArray(quote?.QuoteRoomBlock) ? quote.QuoteRoomBlock : [];
  let total = 0;
  let hasContractedData = false;

  for (const block of roomBlocks) {
    const contracted = parseNumber(block.Contracted);
    const roomRate = parseNumber(block.RoomRate);

    if (contracted === null || roomRate === null || contracted <= 0 || roomRate <= 0) {
      continue;
    }

    total += contracted * roomRate;
    hasContractedData = true;
  }

  if (!hasContractedData) {
    return null;
  }

  return roundCurrency(total);
}

function extractMeetingRoomTotal(quote: MarriottQuote | undefined): number | null {
  const quoteFunctions = Array.isArray(quote?.QuoteFunction) ? quote.QuoteFunction : [];
  const rentals = quoteFunctions
    .map((quoteFunction) => parseNumber(quoteFunction.NegotiatedRoomRental))
    .filter((value): value is number => value !== null);

  if (rentals.length === 0) {
    return null;
  }

  return roundCurrency(rentals.reduce((sum, value) => sum + value, 0));
}

function extractFoodMinimumFromChapter(chapter: MarriottChapter): number | null {
  const title = typeof chapter.title === "string" ? chapter.title : "";
  const description = typeof chapter.description === "string" ? chapter.description : "";

  if (!/\bminimum\b/i.test(`${title} ${description}`)) {
    return null;
  }

  const chapterText = toPlainText([title, description].filter(Boolean).join("\n"), "html");

  const strictPatterns = [
    /\bminimum(?:\s+requirement)?(?:\s+for\s+your\s+program)?\s*(?:is|:)\s*(?:USD|US\$|\$)\s*([0-9][\d,]*(?:\.\d{1,2})?)/i,
    /(?:beverage\s*(?:&|and)\s*food|food\s*(?:&|and)\s*beverage|f&b)[^$]{0,120}\bminimum\b[^$]{0,120}(?:USD|US\$|\$)\s*([0-9][\d,]*(?:\.\d{1,2})?)/i,
    /\bminimum\b[^$]{0,120}(?:USD|US\$|\$)\s*([0-9][\d,]*(?:\.\d{1,2})?)/i,
  ];

  for (const pattern of strictPatterns) {
    const match = chapterText.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const amount = parseNumber(match[1]);
    if (amount !== null) {
      return roundCurrency(amount);
    }
  }

  return null;
}

function extractFoodAndBeverageTotal(
  quote: MarriottQuote | undefined,
  chapters: MarriottChapter[] | undefined,
): number | null {
  const quoteFunctions = Array.isArray(quote?.QuoteFunction) ? quote.QuoteFunction : [];
  const minimumRevenueValues = quoteFunctions
    .map((quoteFunction) => parseNumber(quoteFunction.MinimumFoodRevenue))
    .filter((value): value is number => value !== null);

  if (minimumRevenueValues.length > 0) {
    return roundCurrency(minimumRevenueValues.reduce((sum, value) => sum + value, 0));
  }

  const chapterCandidates = (Array.isArray(chapters) ? chapters : [])
    .map((chapter) => extractFoodMinimumFromChapter(chapter))
    .filter((value): value is number => value !== null);

  if (chapterCandidates.length === 0) {
    return null;
  }

  return Math.max(...chapterCandidates);
}

function buildTotals(
  quote: MarriottQuote | undefined,
  chapters: MarriottChapter[] | undefined,
): MarriottTotals {
  const guestroomTotal = extractGuestroomTotal(quote);
  const meetingRoomTotal = extractMeetingRoomTotal(quote);
  const foodAndBeverageTotal = extractFoodAndBeverageTotal(quote, chapters);

  const components = [guestroomTotal, meetingRoomTotal, foodAndBeverageTotal].filter(
    (value): value is number => value !== null,
  );
  const totalQuote =
    components.length >= 2
      ? roundCurrency(components.reduce((sum, value) => sum + value, 0))
      : null;

  return {
    guestroomTotal,
    meetingRoomTotal,
    foodAndBeverageTotal,
    totalQuote,
  };
}

function buildSummaryText(totals: MarriottTotals): string | null {
  const lines: string[] = [];

  if (totals.guestroomTotal !== null) {
    lines.push(`Guestroom Total: $${formatAmount(totals.guestroomTotal)}`);
  }
  if (totals.meetingRoomTotal !== null) {
    lines.push(`Meeting Room Total: $${formatAmount(totals.meetingRoomTotal)}`);
  }
  if (totals.foodAndBeverageTotal !== null) {
    lines.push(`Food and Beverage Total: $${formatAmount(totals.foodAndBeverageTotal)}`);
  }
  if (totals.totalQuote !== null) {
    lines.push(`Total Quote: $${formatAmount(totals.totalQuote)}`);
  }

  if (lines.length === 0) {
    return null;
  }

  return lines.join("\n");
}

function buildField(
  label: string,
  value: number,
  evidence: string,
  confidence: number,
  derived: boolean,
) {
  return {
    label,
    value,
    displayValue: formatCurrency(value),
    evidence,
    confidence,
    derived,
  };
}

function buildParsedOutputFromTotals(
  totals: MarriottTotals,
  proposalId: string,
): ParseQuoteOutput | null {
  const fields = emptyParsedFields();
  const summaryText = buildSummaryText(totals);

  if (!summaryText) {
    return null;
  }

  if (totals.guestroomTotal !== null) {
    fields.guestroomTotal = buildField(
      fields.guestroomTotal.label,
      totals.guestroomTotal,
      `Extracted from Marriott proposal ${proposalId} room block data`,
      0.92,
      false,
    );
  }

  if (totals.meetingRoomTotal !== null) {
    fields.meetingRoomTotal = buildField(
      fields.meetingRoomTotal.label,
      totals.meetingRoomTotal,
      `Extracted from Marriott proposal ${proposalId} meeting function data`,
      0.88,
      false,
    );
  }

  if (totals.foodAndBeverageTotal !== null) {
    fields.foodAndBeverageTotal = buildField(
      fields.foodAndBeverageTotal.label,
      totals.foodAndBeverageTotal,
      `Extracted from Marriott proposal ${proposalId} food and beverage minimum`,
      0.84,
      false,
    );
  }

  if (totals.totalQuote !== null) {
    fields.totalQuote = buildField(
      fields.totalQuote.label,
      totals.totalQuote,
      `Derived from Marriott proposal ${proposalId} extracted component totals`,
      0.8,
      true,
    );
  }

  const hasAnyField = QUOTE_FIELD_ORDER.some((fieldKey) => fields[fieldKey].value !== null);
  if (!hasAnyField) {
    return null;
  }

  return {
    fields,
    warnings: [],
    normalizedText: summaryText,
  };
}

async function fetchMarriottProposal(proposalId: string): Promise<MarriottProposalResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `https://mi.bookmarriott.com/api/v1/view/proposals/${proposalId}`,
      {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Marriott API returned ${response.status}`);
    }

    return (await response.json()) as MarriottProposalResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function parseMarriottProposalIds(sourceTexts: string[]): string[] {
  const ids = new Set<string>();

  for (const source of sourceTexts) {
    for (const match of source.matchAll(MARRIOTT_PROPOSAL_ID_RE)) {
      const id = (match[1] ?? "").toLowerCase();
      if (id) {
        ids.add(id);
      }
    }
  }

  return [...ids];
}

async function parseProposalId(proposalId: string): Promise<ParseQuoteOutput | null> {
  const proposal = await fetchMarriottProposal(proposalId);
  const quote = proposal.data?.options?.ciData?.Quote?.[0];
  const chapters = proposal.data?.chapters;
  const totals = buildTotals(quote, chapters);
  return buildParsedOutputFromTotals(totals, proposalId);
}

export function findMarriottProposalIds(sourceTexts: string[]): string[] {
  return parseMarriottProposalIds(sourceTexts);
}

export async function enrichFromMarriottLinks(
  sourceTexts: string[],
): Promise<MarriottLinkEnrichmentResult> {
  const proposalIds = parseMarriottProposalIds(sourceTexts);

  if (proposalIds.length === 0) {
    return {
      enrichment: null,
      warning: null,
    };
  }

  const errors: string[] = [];

  for (const proposalId of proposalIds) {
    try {
      const parsed = await parseProposalId(proposalId);
      if (parsed) {
        return {
          enrichment: {
            proposalId,
            parsed,
          },
          warning: null,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push(message);
    }
  }

  return {
    enrichment: null,
    warning: `Detected Marriott proposal link, but enrichment failed (${errors[0] ?? "no totals found"}).`,
  };
}
