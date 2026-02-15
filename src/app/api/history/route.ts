import { NextResponse } from "next/server";

import { HistoryApiResponse } from "@/lib/quote-types";
import { getRecentParsedQuotes, isSupabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const supabaseConfigured = isSupabaseConfigured();

  if (!supabaseConfigured) {
    const payload: HistoryApiResponse = {
      rows: [],
      supabaseConfigured,
    };
    return NextResponse.json(payload);
  }

  try {
    const rows = await getRecentParsedQuotes(20);
    const payload: HistoryApiResponse = {
      rows,
      supabaseConfigured,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const payload: HistoryApiResponse = {
      rows: [],
      supabaseConfigured,
      error: error instanceof Error ? error.message : "Failed to fetch history.",
    };

    return NextResponse.json(payload, { status: 500 });
  }
}
