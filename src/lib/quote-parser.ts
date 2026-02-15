import { convert as htmlToText } from "html-to-text";

import {
  emptyParsedFields,
  formatCurrency,
  ParsedField,
  ParsedQuoteFields,
  QuoteFieldKey,
} from "@/lib/quote-types";

export type RawContentFormat = "auto" | "html" | "text";

interface ExtractionCandidate {
  amount: number;
  evidence: string;
  confidence: number;
  derived: boolean;
}

export interface ParseQuoteOutput {
  fields: ParsedQuoteFields;
  warnings: string[];
  normalizedText: string;
}

const CURRENCY_RE =
  /(?:USD|US\$|\$)\s*((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.\d{1,2})?)(?:\s*\+\+)?/gi;

const HTML_LIKE_RE = /<\/?(?:html|body|table|div|span|p|br|tr|td|a)[\s>]/i;
const WEEKDAY_PREFIX_RE = /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+/i;
const NAMED_DATE_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i;

const MONTH_INDEX_BY_NAME: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function clampConfidence(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }

  return Number(value.toFixed(2));
}

function normalizeLine(input: string): string {
  return input.replace(/[\t\u00A0]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeText(input: string): string {
  return input.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseAmountToken(raw: string): number | null {
  const normalized = raw.replace(/,/g, "").trim();
  const value = Number.parseFloat(normalized);

  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(2));
}

function extractCurrencyAmounts(text: string): number[] {
  const matches = [...text.matchAll(CURRENCY_RE)];

  return matches
    .map((match) => parseAmountToken(match[1] ?? ""))
    .filter((value): value is number => value !== null && value > 0);
}

function safeSnippet(line: string): string {
  const compact = normalizeLine(line);
  if (compact.length <= 220) {
    return compact;
  }
  return `${compact.slice(0, 217)}...`;
}

function splitIntoLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => normalizeLine(line))
    .filter((line) => line.length > 0);
}

function hasAnyKeyword(text: string, keywords: RegExp[]): boolean {
  return keywords.some((keyword) => keyword.test(text));
}

function buildField(label: string, candidate?: ExtractionCandidate): ParsedField {
  if (!candidate) {
    return {
      label,
      value: null,
      displayValue: null,
      evidence: null,
      confidence: 0,
      derived: false,
    };
  }

  return {
    label,
    value: Number(candidate.amount.toFixed(2)),
    displayValue: formatCurrency(candidate.amount),
    evidence: candidate.evidence,
    confidence: clampConfidence(candidate.confidence),
    derived: candidate.derived,
  };
}

function chooseAmount(amounts: number[], preference: "first" | "last" | "max"): number {
  if (preference === "first") {
    return amounts[0];
  }
  if (preference === "max") {
    return Math.max(...amounts);
  }
  return amounts[amounts.length - 1];
}

function pickBestCandidate(candidates: ExtractionCandidate[]): ExtractionCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return b.amount - a.amount;
  });

  return candidates[0];
}

function findCandidatesByKeywords(
  lines: string[],
  keywords: RegExp[],
  options?: {
    exclude?: RegExp[];
    preference?: "first" | "last" | "max";
    useWithoutClause?: boolean;
  },
): ExtractionCandidate[] {
  const candidates: ExtractionCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const combined = `${line} ${lines[index + 1] ?? ""}`.trim();

    if (!hasAnyKeyword(combined, keywords)) {
      continue;
    }

    if (options?.exclude?.some((exclude) => exclude.test(combined))) {
      continue;
    }

    const amounts = extractCurrencyAmounts(combined);

    if (amounts.length === 0) {
      continue;
    }

    let selectedAmount: number;

    if (options?.useWithoutClause) {
      const withoutMatch = combined.match(
        /without[^$]{0,120}(?:USD|US\$|\$)\s*([0-9][\d,]*(?:\.\d{1,2})?)/i,
      );
      if (withoutMatch?.[1]) {
        const parsed = parseAmountToken(withoutMatch[1]);
        if (parsed !== null) {
          selectedAmount = parsed;
        } else {
          selectedAmount = chooseAmount(amounts, options.preference ?? "last");
        }
      } else {
        selectedAmount = chooseAmount(amounts, options.preference ?? "last");
      }
    } else {
      selectedAmount = chooseAmount(amounts, options?.preference ?? "last");
    }

    let confidence = 0.64;

    if (/\b(total|grand|overall)\b/i.test(combined)) {
      confidence += 0.16;
    }
    if (/\b(quote|estimated|min(?:imum)?)\b/i.test(combined)) {
      confidence += 0.08;
    }
    if (/\b(rate|subject to change)\b/i.test(combined) && !/\btotal\b/i.test(combined)) {
      confidence -= 0.06;
    }
    if (/%/.test(combined) && !/\bminimum\b/i.test(combined)) {
      confidence -= 0.08;
    }
    if (amounts.length > 1) {
      confidence -= 0.03;
    }

    candidates.push({
      amount: selectedAmount,
      evidence: safeSnippet(combined),
      confidence: clampConfidence(confidence),
      derived: false,
    });
  }

  return candidates;
}

function findMeetingRoomCandidate(lines: string[]): ExtractionCandidate | undefined {
  const meetingKeywords = [
    /meeting\s*room/i,
    /meeting\s*space/i,
    /function\s*room/i,
    /room\s*rental/i,
    /conference\s*room/i,
  ];

  const candidates: ExtractionCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const context = lines.slice(index, index + 4).join(" ").trim();

    if (!hasAnyKeyword(context, meetingKeywords)) {
      continue;
    }

    const hasComplimentaryLanguage = /\b(waived|complimentary|included|no charge)\b/i.test(context);
    const withoutAfterMatch = context.match(
      /without[^$]{0,120}(?:USD|US\$|\$)\s*([0-9][\d,]*(?:\.\d{1,2})?)/i,
    );
    const withoutIndex = context.search(/\bwithout\b/i);
    const beforeWithoutAmounts =
      withoutIndex > 0 ? extractCurrencyAmounts(context.slice(0, withoutIndex)) : [];

    if (withoutAfterMatch?.[1]) {
      const amount = parseAmountToken(withoutAfterMatch[1]);
      if (amount !== null) {
        candidates.push({
          amount,
          evidence: safeSnippet(context),
          confidence: 0.82,
          derived: false,
        });
        continue;
      }
    }

    if (beforeWithoutAmounts.length > 0) {
      candidates.push({
        amount: beforeWithoutAmounts[beforeWithoutAmounts.length - 1],
        evidence: safeSnippet(context),
        confidence: 0.8,
        derived: false,
      });
      continue;
    }

    if (hasComplimentaryLanguage && /\b(f&b|food\s*(?:and|&)\s*beverage)\b/i.test(context)) {
      candidates.push({
        amount: 0,
        evidence: safeSnippet(context),
        confidence: 0.78,
        derived: false,
      });
      continue;
    }

    const directAmounts = extractCurrencyAmounts(context);
    if (directAmounts.length > 0 && !/\b(f&b|food\s*(?:and|&)\s*beverage)\b/i.test(context)) {
      candidates.push({
        amount: chooseAmount(directAmounts, "last"),
        evidence: safeSnippet(context),
        confidence: 0.7,
        derived: false,
      });
      continue;
    }

    if (hasComplimentaryLanguage) {
      candidates.push({
        amount: 0,
        evidence: safeSnippet(context),
        confidence: 0.66,
        derived: false,
      });
    }
  }

  return pickBestCandidate(candidates);
}

function extractRoomRate(lines: string[]): ExtractionCandidate | undefined {
  const rateKeywords = [/\brate\b/i, /group\s*rate/i, /run\s*of\s*the\s*house/i];

  const candidates: ExtractionCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const context = `${lines[index]} ${lines[index + 1] ?? ""}`.trim();

    if (!hasAnyKeyword(context, rateKeywords)) {
      continue;
    }

    if (/\b(f&b|food\s*(?:and|&)\s*beverage|tax|fee|valet|uber|lyft)\b/i.test(context)) {
      continue;
    }

    const amounts = extractCurrencyAmounts(context);
    if (amounts.length === 0) {
      continue;
    }

    candidates.push({
      amount: amounts[0],
      evidence: safeSnippet(context),
      confidence: 0.66,
      derived: true,
    });
  }

  return pickBestCandidate(candidates);
}

function parseNamedDate(value: string): Date | null {
  const cleaned = normalizeLine(value).replace(WEEKDAY_PREFIX_RE, "");
  const match = cleaned.match(NAMED_DATE_RE);

  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  const monthKey = match[1].slice(0, 3).toLowerCase();
  const monthIndex = MONTH_INDEX_BY_NAME[monthKey];
  const day = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);

  if (
    monthIndex === undefined ||
    !Number.isFinite(day) ||
    !Number.isFinite(year) ||
    day < 1 ||
    day > 31 ||
    year < 1900
  ) {
    return null;
  }

  return new Date(Date.UTC(year, monthIndex, day));
}

function parseIntegerValue(value: string): number | null {
  const match = value.match(/\b(\d{1,5})\b/);

  if (!match?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function extractValueAfterLabel(line: string, labelPattern: RegExp): string {
  return normalizeLine(line.replace(labelPattern, "").replace(/^[:\-–]\s*/, ""));
}

function extractDateByLabel(lines: string[], labelPattern: RegExp): Date | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!labelPattern.test(line)) {
      continue;
    }

    const inlineValue = extractValueAfterLabel(line, labelPattern);
    const inlineDate = parseNamedDate(inlineValue);
    if (inlineDate) {
      return inlineDate;
    }

    const nextLineDate = parseNamedDate(lines[index + 1] ?? "");
    if (nextLineDate) {
      return nextLineDate;
    }
  }

  return null;
}

function extractRoomCount(lines: string[]): number | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!/\b(number of rooms|total number of guestrooms|total guestrooms)\b/i.test(line)) {
      continue;
    }

    const inlineValue = extractValueAfterLabel(
      line,
      /\b(number of rooms|total number of guestrooms|total guestrooms)\b/i,
    );
    const inlineCount = parseIntegerValue(inlineValue);
    if (inlineCount !== null && inlineCount > 0) {
      return inlineCount;
    }

    const nextLineCount = parseIntegerValue(lines[index + 1] ?? "");
    if (nextLineCount !== null && nextLineCount > 0) {
      return nextLineCount;
    }
  }

  return null;
}

function extractRoomNightsFromDateRange(lines: string[]): number | null {
  const checkIn = extractDateByLabel(lines, /\bcheck[-\s]?in\b/i);
  const checkOut = extractDateByLabel(lines, /\bcheck[-\s]?out\b/i);
  const roomCount = extractRoomCount(lines);

  if (!checkIn || !checkOut || !roomCount || roomCount <= 0) {
    return null;
  }

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY);

  if (nights <= 0 || nights > 60) {
    return null;
  }

  return nights * roomCount;
}

function extractRoomNights(lines: string[], text: string): number | null {
  const perNightMatch = text.match(/(\d{1,4})\s*per\s*night\s*=\s*(\d{1,6})/i);
  if (perNightMatch?.[2]) {
    return Number.parseInt(perNightMatch[2], 10);
  }

  const roomNightsMatch = text.match(/(\d{1,6})\s*room\s*nights?/i);
  if (roomNightsMatch?.[1]) {
    return Number.parseInt(roomNightsMatch[1], 10);
  }

  const roomNightsFromDateRange = extractRoomNightsFromDateRange(lines);
  if (roomNightsFromDateRange !== null) {
    return roomNightsFromDateRange;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const context = `${lines[index]} ${lines[index + 1] ?? ""}`.trim();

    if (!/\b(rate|run\s*of\s*the\s*house|rooms?,\s*rates?)\b/i.test(context)) {
      continue;
    }

    if (!/\$/.test(context)) {
      continue;
    }

    const currencyAmounts = extractCurrencyAmounts(context);
    const integers = [...context.matchAll(/\b(\d{2,5})\b/g)]
      .map((match) => Number.parseInt(match[1], 10))
      .filter((value) => Number.isFinite(value) && value >= 40 && value < 10000)
      .filter((value) => value < 1900 || value > 2100)
      .filter(
        (value) =>
          !currencyAmounts.some((currencyAmount) => Math.abs(currencyAmount - value) < 0.01),
      );

    if (integers.length >= 2) {
      return Math.max(...integers);
    }
  }

  return null;
}

function deriveGuestroomTotal(lines: string[], text: string): ExtractionCandidate | undefined {
  const rate = extractRoomRate(lines);
  const roomNights = extractRoomNights(lines, text);

  if (!rate || roomNights === null || roomNights <= 0) {
    return undefined;
  }

  return {
    amount: Number((rate.amount * roomNights).toFixed(2)),
    evidence: `Derived from ${formatCurrency(rate.amount)} room rate and ${roomNights} room nights`,
    confidence: 0.68,
    derived: true,
  };
}

function deriveTotalQuote(fields: ParsedQuoteFields): ExtractionCandidate | undefined {
  const components: Array<{ key: QuoteFieldKey; amount: number }> = [];

  if (fields.guestroomTotal.value !== null) {
    components.push({ key: "guestroomTotal", amount: fields.guestroomTotal.value });
  }
  if (fields.meetingRoomTotal.value !== null) {
    components.push({ key: "meetingRoomTotal", amount: fields.meetingRoomTotal.value });
  }
  if (fields.foodAndBeverageTotal.value !== null) {
    components.push({ key: "foodAndBeverageTotal", amount: fields.foodAndBeverageTotal.value });
  }

  if (components.length < 2) {
    return undefined;
  }

  const total = Number(
    components.reduce((sum, component) => sum + component.amount, 0).toFixed(2),
  );
  const evidence = components
    .map((component) => `${fields[component.key].label}: ${formatCurrency(component.amount)}`)
    .join(" + ");

  return {
    amount: total,
    evidence: `Derived from component totals (${evidence})`,
    confidence: components.length >= 3 ? 0.66 : 0.6,
    derived: true,
  };
}

function guessIfHtml(rawContent: string): boolean {
  return HTML_LIKE_RE.test(rawContent);
}

export function toPlainText(rawContent: string, format: RawContentFormat = "auto"): string {
  if (!rawContent.trim()) {
    return "";
  }

  if (format === "text") {
    return normalizeText(rawContent);
  }

  const shouldConvertHtml = format === "html" || (format === "auto" && guessIfHtml(rawContent));

  if (!shouldConvertHtml) {
    return normalizeText(rawContent);
  }

  const converted = htmlToText(rawContent, {
    preserveNewlines: true,
    wordwrap: false,
    selectors: [
      {
        selector: "a",
        options: {
          ignoreHref: true,
        },
      },
      {
        selector: "img",
        format: "skip",
      },
    ],
  });

  return normalizeText(converted);
}

export function parseQuoteText(text: string): ParseQuoteOutput {
  const normalizedText = normalizeText(text);
  const lines = splitIntoLines(normalizedText);

  const warnings: string[] = [];
  if (lines.length < 4) {
    warnings.push("Input is very short; parser confidence may be limited.");
  }

  const fields = emptyParsedFields();

  const totalQuoteCandidates = findCandidatesByKeywords(
    lines,
    [
      /total\s*quote/i,
      /grand\s*total/i,
      /overall\s*total/i,
      /total\s*cost/i,
      /estimated\s*total/i,
      /total\s*amount/i,
      /total\s*revenue/i,
    ],
    {
      exclude: [/\bcancellation\b/i, /\battrition\b/i],
      preference: "max",
    },
  );

  const guestroomCandidates = findCandidatesByKeywords(
    lines,
    [
      /guest\s*rooms?\s*total/i,
      /guestroom\s*total/i,
      /guest\s*room\s*revenue/i,
      /guestroom\s*revenue/i,
      /sleeping\s*room\s*total/i,
      /room\s*revenue/i,
      /rooms?\s*total/i,
    ],
    {
      exclude: [/\bf&b\b/i, /food\s*(?:and|&)\s*beverage/i, /meeting\s*room/i],
      preference: "max",
    },
  );

  const foodAndBeverageCandidates = findCandidatesByKeywords(
    lines,
    [
      /\bf&b\b/i,
      /food\s*(?:and|&)\s*beverage/i,
      /banquet/i,
      /catering/i,
      /food\s*minimum/i,
      /beverage\s*minimum/i,
    ],
    {
      exclude: [/\bservice\s*charge\b/i, /\bsales\s*tax\b/i],
      preference: "max",
    },
  );

  const totalQuoteCandidate = pickBestCandidate(totalQuoteCandidates);
  const explicitGuestroomCandidate = pickBestCandidate(guestroomCandidates);
  const guestroomCandidate = explicitGuestroomCandidate ?? deriveGuestroomTotal(lines, normalizedText);

  const meetingRoomCandidate = findMeetingRoomCandidate(lines);
  const foodAndBeverageCandidate = pickBestCandidate(foodAndBeverageCandidates);

  fields.guestroomTotal = buildField(fields.guestroomTotal.label, guestroomCandidate);
  fields.meetingRoomTotal = buildField(fields.meetingRoomTotal.label, meetingRoomCandidate);
  fields.foodAndBeverageTotal = buildField(
    fields.foodAndBeverageTotal.label,
    foodAndBeverageCandidate,
  );

  const finalTotalQuoteCandidate = totalQuoteCandidate ?? deriveTotalQuote(fields);
  fields.totalQuote = buildField(fields.totalQuote.label, finalTotalQuoteCandidate);

  if (Object.values(fields).every((field) => field.value === null)) {
    warnings.push("No required totals were detected in this input.");
  }

  return {
    fields,
    warnings,
    normalizedText,
  };
}

export function parseQuoteContent(
  rawContent: string,
  format: RawContentFormat = "auto",
): ParseQuoteOutput {
  const plainText = toPlainText(rawContent, format);
  return parseQuoteText(plainText);
}
