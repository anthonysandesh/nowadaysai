import { createClient } from "@supabase/supabase-js";

import { ParsedQuoteFields, QuoteHistoryRow } from "@/lib/quote-types";

interface SaveQuoteInput {
  sourceName: string;
  sourceType: "pasted" | "file";
  fields: ParsedQuoteFields;
  normalizedTextPreview: string;
}

interface SaveQuoteResult {
  saved: boolean;
  recordId: string | null;
  error: string | null;
}

function getSupabaseEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function isSupabaseConfigured(): boolean {
  const env = getSupabaseEnv();
  return Boolean(env.url && env.anonKey);
}

function getSupabaseClient() {
  const env = getSupabaseEnv();
  if (!env.url || !env.anonKey) {
    return null;
  }

  return createClient(env.url, env.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function saveParsedQuote(input: SaveQuoteInput): Promise<SaveQuoteResult> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      saved: false,
      recordId: null,
      error: "Supabase environment variables are not configured.",
    };
  }

  const evidence = {
    total_quote: input.fields.totalQuote.evidence,
    guestroom_total: input.fields.guestroomTotal.evidence,
    meeting_room_total: input.fields.meetingRoomTotal.evidence,
    food_and_beverage_total: input.fields.foodAndBeverageTotal.evidence,
  };

  const payload = {
    source_name: input.sourceName,
    source_type: input.sourceType,
    total_quote: input.fields.totalQuote.value,
    guestroom_total: input.fields.guestroomTotal.value,
    meeting_room_total: input.fields.meetingRoomTotal.value,
    food_and_beverage_total: input.fields.foodAndBeverageTotal.value,
    evidence,
    raw_preview: input.normalizedTextPreview,
  };

  const { data, error } = await client
    .from("parsed_quotes")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    return {
      saved: false,
      recordId: null,
      error: error.message,
    };
  }

  return {
    saved: true,
    recordId: data?.id ?? null,
    error: null,
  };
}

export async function getRecentParsedQuotes(limit = 20): Promise<QuoteHistoryRow[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from("parsed_quotes")
    .select(
      "id, source_name, source_type, total_quote, guestroom_total, meeting_room_total, food_and_beverage_total, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as QuoteHistoryRow[];
}
