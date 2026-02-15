# Hotel Quote Parser

A React + Tailwind + Supabase app for parsing hotel quote emails (HTML/plain text/PDF) and extracting:
- Total Quote
- Guestroom Total
- Meeting Room Total
- Food and Beverage Total

## Stack
- Next.js (React App Router)
- Tailwind CSS
- Supabase (PostgreSQL)
- `pdf-parse` for PDF text extraction
- `html-to-text` for HTML email normalization

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

### Required Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

If env vars are missing, parsing still works, but history persistence is disabled.

## Supabase Setup

Run this SQL in Supabase SQL Editor:

- `/hotel-quote-parser/supabase/schema.sql`

This creates a `parsed_quotes` table and demo anon `insert/select` policies for this takehome.

## How It Works

1. Input: user pastes email content (auto/HTML/plain) and/or uploads files (`.pdf`, `.html`, `.txt`).
2. Normalization:
   - HTML -> plain text via `html-to-text`
   - PDF -> plain text via `pdf-parse`
3. Parsing:
   - rule-based extraction with keyword + currency matching
   - special handling for meeting-room waived/complimentary wording
   - fallback derivations:
     - guestroom total from room rate x room nights
     - room nights from explicit room-night text OR (`check-in` + `check-out`) x `number of rooms`
   - total quote fallback as sum of components when explicit total is absent
4. Linked proposal enrichment:
   - detects Marriott links like `bookmarriott.com/proposals/view/<uuid>` in pasted/uploaded content
   - fetches proposal JSON from Marriott's public view endpoint
   - derives missing fields from structured data:
     - guestroom total from contracted rooms x room rate
     - meeting room total from negotiated room rental
     - food and beverage total from minimum food revenue / chapter minimum text
   - merges only missing fields; preserves direct values found in the original email content
5. Persistence: parsed results are inserted into Supabase and displayed in recent history.

## API Endpoints
- `POST /api/parse` parses pasted content and uploaded files, then enriches missing totals when a Marriott proposal link is present.
- `GET /api/history` returns latest saved parsed quotes.

## Project Structure

- `/hotel-quote-parser/src/app/page.tsx`: main UI
- `/hotel-quote-parser/src/app/api/parse/route.ts`: parse endpoint
- `/hotel-quote-parser/src/app/api/history/route.ts`: history endpoint
- `/hotel-quote-parser/src/lib/quote-parser.ts`: extraction engine
- `/hotel-quote-parser/src/lib/marriott-enrichment.ts`: Marriott link enrichment
- `/hotel-quote-parser/src/lib/pdf.ts`: PDF extraction helper
- `/hotel-quote-parser/src/lib/supabase.ts`: persistence layer
- `/hotel-quote-parser/supabase/schema.sql`: DB schema + policies

## Validate Against Provided Samples

```bash
npm run parse:samples
```

This reads files from:
`/email samples`

Expected coverage with current parser:
- `sample_1.html` / `sample_1.pdf`: all four required totals extracted.
- `sample_2.html` / `sample_2.pdf`: totals extracted via Marriott link enrichment.
- `sample_3.html`: guestroom total derived from rate + date range + room count.
- `sample_3.pdf`: all four required totals extracted.

Note: Marriott link enrichment requires outbound network access to `mi.bookmarriott.com`.

## Development Process and Decisions (Written Response)

### Approach
I built a parser-first workflow: normalize all incoming content into plain text, then run targeted extraction rules for each required financial field. This keeps the system transparent and debuggable while handling mixed email formats.

### Key Challenges
1. Source variability: some quotes provide explicit totals while others only provide rates or minimums.
2. Ambiguous lines: statements like “meeting room waived with $X F&B minimum / $Y without minimum” require contextual handling.
3. PDF table extraction noise: parsed text often flattens tabular data into hard-to-read lines.
4. Link-only emails: some responses include no totals in the email body and only a hosted proposal link.

### Solutions
1. Category-specific extraction rules (total/guestroom/meeting/F&B), each with keyword filters and confidence scoring.
2. Domain-specific handling for waived/complimentary meeting space and “without minimum” cases.
3. Fallback derivations when explicit totals are absent (guestroom = rate x room nights, including date-range room-night inference; total quote = sum of available components).
4. Marriott link enrichment to fetch structured quote data and backfill missing fields.

### Tradeoffs
- Rule-based parsing is explainable and quick to iterate, but it is less adaptive than ML extraction.
- Confidence scores are heuristic, not statistically calibrated.
- In rare edge cases, derived totals may include assumptions that differ from hotel intent.

### If I Had More Time
1. Add a trainable extraction layer (LLM or token classifier) with structured output validation.
2. Build per-hotel parser profiles to improve precision by brand/template.
3. Add a side-by-side evidence highlighter in UI and parser regression tests across more samples.
4. Tighten Supabase RLS to authenticated users and add row ownership.

### Suggested Demo Flow
1. Parse `sample_1.pdf` and show extracted totals + evidence.
2. Parse `sample_2.html` and show Marriott link enrichment filling missing totals.
3. Parse `sample_3.html` and show date-range room-night derivation behavior.
4. Show recent parsed quotes table updating.
