export type QuoteFieldKey =
  | "totalQuote"
  | "guestroomTotal"
  | "meetingRoomTotal"
  | "foodAndBeverageTotal";

export interface ParsedField {
  label: string;
  value: number | null;
  displayValue: string | null;
  evidence: string | null;
  confidence: number;
  derived: boolean;
}

export type ParsedQuoteFields = Record<QuoteFieldKey, ParsedField>;

export interface ParsedQuoteResult {
  sourceName: string;
  sourceType: "pasted" | "file";
  fields: ParsedQuoteFields;
  warnings: string[];
  normalizedTextPreview: string;
  saved: boolean;
  savedError: string | null;
  recordId: string | null;
}

export interface ParseApiResponse {
  results: ParsedQuoteResult[];
  supabaseConfigured: boolean;
}

export interface HistoryApiResponse {
  rows: QuoteHistoryRow[];
  supabaseConfigured: boolean;
  error?: string;
}

export interface QuoteHistoryRow {
  id: string;
  source_name: string;
  source_type: string;
  total_quote: number | null;
  guestroom_total: number | null;
  meeting_room_total: number | null;
  food_and_beverage_total: number | null;
  created_at: string;
}

export const QUOTE_FIELD_ORDER: QuoteFieldKey[] = [
  "totalQuote",
  "guestroomTotal",
  "meetingRoomTotal",
  "foodAndBeverageTotal",
];

export const QUOTE_FIELD_LABELS: Record<QuoteFieldKey, string> = {
  totalQuote: "Total Quote",
  guestroomTotal: "Guestroom Total",
  meetingRoomTotal: "Meeting Room Total",
  foodAndBeverageTotal: "Food and Beverage Total",
};

export function formatCurrency(value: number | null): string | null {
  if (value === null || Number.isNaN(value)) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function emptyParsedFields(): ParsedQuoteFields {
  return {
    totalQuote: {
      label: QUOTE_FIELD_LABELS.totalQuote,
      value: null,
      displayValue: null,
      evidence: null,
      confidence: 0,
      derived: false,
    },
    guestroomTotal: {
      label: QUOTE_FIELD_LABELS.guestroomTotal,
      value: null,
      displayValue: null,
      evidence: null,
      confidence: 0,
      derived: false,
    },
    meetingRoomTotal: {
      label: QUOTE_FIELD_LABELS.meetingRoomTotal,
      value: null,
      displayValue: null,
      evidence: null,
      confidence: 0,
      derived: false,
    },
    foodAndBeverageTotal: {
      label: QUOTE_FIELD_LABELS.foodAndBeverageTotal,
      value: null,
      displayValue: null,
      evidence: null,
      confidence: 0,
      derived: false,
    },
  };
}
