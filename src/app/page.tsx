"use client";

import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  formatCurrency,
  HistoryApiResponse,
  ParseApiResponse,
  ParsedField,
  ParsedQuoteResult,
  QUOTE_FIELD_ORDER,
} from "@/lib/quote-types";

const PASTE_FORMAT_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "html", label: "HTML" },
  { value: "text", label: "Plain text" },
] as const;

const REQUIRED_FIELDS_COUNT = QUOTE_FIELD_ORDER.length;

function fileIdentity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function mergeUniqueFiles(existing: File[], incoming: File[]): File[] {
  const byKey = new Map<string, File>();

  for (const file of existing) {
    byKey.set(fileIdentity(file), file);
  }

  for (const file of incoming) {
    byKey.set(fileIdentity(file), file);
  }

  return Array.from(byKey.values());
}

function countParsedFields(result: ParsedQuoteResult): number {
  return QUOTE_FIELD_ORDER.filter((key) => result.fields[key].value !== null).length;
}

function formatRelativeTime(value: string): string {
  const targetTime = new Date(value).getTime();
  if (!Number.isFinite(targetTime)) {
    return "-";
  }

  const seconds = Math.round((Date.now() - targetTime) / 1000);
  const absoluteSeconds = Math.abs(seconds);

  if (absoluteSeconds < 60) {
    return "just now";
  }

  const minutes = Math.round(absoluteSeconds / 60);
  if (minutes < 60) {
    return seconds >= 0 ? `${minutes}m ago` : `in ${minutes}m`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return seconds >= 0 ? `${hours}h ago` : `in ${hours}h`;
  }

  const days = Math.round(hours / 24);
  return seconds >= 0 ? `${days}d ago` : `in ${days}d`;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const label =
    confidence >= 0.8 ? "High" : confidence >= 0.6 ? "Medium" : confidence > 0 ? "Low" : "None";
  const tone =
    confidence >= 0.8
      ? "bg-emerald-100 text-emerald-700"
      : confidence >= 0.6
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-600";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {label} ({Math.round(confidence * 100)}%)
    </span>
  );
}

function FieldCard({ field }: { field: ParsedField }) {
  return (
    <article className="rounded-xl border border-[#d8e6ea] bg-white p-4 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.75)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#5d7078]">{field.label}</p>
        {field.derived ? (
          <span className="rounded-full bg-[#e1f2f7] px-2 py-0.5 text-[11px] font-semibold text-[#2d6a7c]">
            Derived
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-2xl font-semibold text-[#11303b]">{field.displayValue ?? "Not found"}</p>

      <div className="mt-3">
        <ConfidenceBadge confidence={field.confidence} />
      </div>

      {field.evidence ? (
        <details className="mt-3 rounded-lg border border-[#d9e7ea] bg-[#f7fbfd] px-3 py-2 text-xs text-[#48616b]">
          <summary className="cursor-pointer font-semibold text-[#345766]">Evidence</summary>
          <p className="mt-2 leading-relaxed">{field.evidence}</p>
        </details>
      ) : null}
    </article>
  );
}

function HistoryTable({
  rows,
}: {
  rows: HistoryApiResponse["rows"];
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#c8d7dc] bg-white/70 p-6 text-sm text-[#50646c]">
        No saved parses yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[#d6e4e8] bg-white">
      <table className="min-w-full divide-y divide-[#dce8ec] text-sm">
        <thead className="bg-[#f4f9fb] text-left text-xs uppercase tracking-[0.08em] text-[#5e747b]">
          <tr>
            <th className="px-4 py-3">Source</th>
            <th className="px-4 py-3">Total Quote</th>
            <th className="px-4 py-3">Guestroom</th>
            <th className="px-4 py-3">Meeting Room</th>
            <th className="px-4 py-3">F&B</th>
            <th className="px-4 py-3">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#edf3f6] text-[#234550]">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3 font-medium">{row.source_name}</td>
              <td className="px-4 py-3">{formatCurrency(row.total_quote) ?? "-"}</td>
              <td className="px-4 py-3">{formatCurrency(row.guestroom_total) ?? "-"}</td>
              <td className="px-4 py-3">{formatCurrency(row.meeting_room_total) ?? "-"}</td>
              <td className="px-4 py-3">{formatCurrency(row.food_and_beverage_total) ?? "-"}</td>
              <td className="px-4 py-3" title={new Date(row.created_at).toLocaleString()}>
                {formatRelativeTime(row.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Home() {
  const [pastedContent, setPastedContent] = useState("");
  const [pastedFormat, setPastedFormat] = useState<(typeof PASTE_FORMAT_OPTIONS)[number]["value"]>(
    "auto",
  );
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ParsedQuoteResult[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [historyRows, setHistoryRows] = useState<HistoryApiResponse["rows"]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasInput = useMemo(
    () => pastedContent.trim().length > 0 || selectedFiles.length > 0,
    [pastedContent, selectedFiles],
  );

  const activeResult = results[activeResultIndex] ?? null;
  const activeResultFoundFields = activeResult ? countParsedFields(activeResult) : 0;

  const filteredHistoryRows = useMemo(() => {
    if (!historyQuery.trim()) {
      return historyRows;
    }

    const query = historyQuery.trim().toLowerCase();
    return historyRows.filter((row) => row.source_name.toLowerCase().includes(query));
  }, [historyRows, historyQuery]);

  useEffect(() => {
    if (activeResultIndex >= results.length) {
      setActiveResultIndex(results.length > 0 ? results.length - 1 : 0);
    }
  }, [activeResultIndex, results.length]);

  const refreshHistory = async () => {
    setIsLoadingHistory(true);

    try {
      const response = await fetch("/api/history");
      const payload = (await response.json()) as HistoryApiResponse;

      if (!response.ok) {
        setNotice(payload.error ?? "Could not load history.");
      } else {
        setHistoryRows(payload.rows ?? []);
      }

      if (!payload.supabaseConfigured) {
        setNotice(
          "Supabase is not configured yet. Parsing still works, but history will remain local to the page.",
        );
      }
    } catch {
      setNotice("Could not reach history API.");
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    void refreshHistory();
  }, []);

  const handleDropFiles = (incomingFiles: File[]) => {
    if (incomingFiles.length === 0) {
      return;
    }

    setSelectedFiles((current) => mergeUniqueFiles(current, incomingFiles));
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleDropFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    handleDropFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const clearInput = () => {
    setPastedContent("");
    setSelectedFiles([]);
  };

  const clearResults = () => {
    setResults([]);
    setActiveResultIndex(0);
  };

  const copyResultJson = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();

    if (!activeResult) {
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(activeResult, null, 2));
      setNotice("Copied active result JSON.");
    } catch {
      setNotice("Clipboard permission denied in this browser.");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!hasInput) {
      setError("Paste email content or upload at least one file.");
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("pastedContent", pastedContent);
      formData.append("pastedFormat", pastedFormat);

      for (const file of selectedFiles) {
        formData.append("files", file);
      }

      const response = await fetch("/api/parse", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as ParseApiResponse & { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Failed to parse quote.");
        return;
      }

      const nextResults = payload.results ?? [];
      setResults(nextResults);
      setActiveResultIndex(0);

      if (!payload.supabaseConfigured) {
        setNotice(
          "Supabase is not configured yet. Results are shown immediately but are not being persisted.",
        );
      } else {
        setNotice(null);
      }

      void refreshHistory();
    } catch {
      setError("Unexpected error while parsing. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_0%,#cdeff9_0%,#f5fbfd_36%,#f7faf4_100%)] px-4 py-8 sm:px-8">
      <section className="mx-auto w-full max-w-6xl space-y-6">
        <header className="rounded-2xl border border-[#d9e7ea] bg-white/90 p-6 shadow-[0_26px_60px_-48px_rgba(13,38,56,0.9)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.11em] text-[#3a6e7c]">Nowadays Takehome</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#10313c] sm:text-4xl">
            Hotel Quote Parser
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#47626c] sm:text-base">
            Paste raw email content (HTML or plain text) or upload quote files to extract info.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[#d6e5e9] bg-[#f8fcfd] p-3">
              <p className="text-xs uppercase tracking-[0.08em] text-[#617a82]">Input Ready</p>
              <p className="mt-1 text-xl font-semibold text-[#1a3f4c]">{hasInput ? "Yes" : "No"}</p>
            </div>
            <div className="rounded-xl border border-[#d6e5e9] bg-[#f8fcfd] p-3">
              <p className="text-xs uppercase tracking-[0.08em] text-[#617a82]">Latest Parse</p>
              <p className="mt-1 text-xl font-semibold text-[#1a3f4c]">{results.length} source(s)</p>
            </div>
            <div className="rounded-xl border border-[#d6e5e9] bg-[#f8fcfd] p-3">
              <p className="text-xs uppercase tracking-[0.08em] text-[#617a82]">Saved History</p>
              <p className="mt-1 text-xl font-semibold text-[#1a3f4c]">{historyRows.length} rows</p>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-[#d6e5e9] bg-white p-6 shadow-[0_22px_65px_-50px_rgba(15,23,42,0.9)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#173742]">Input</h2>
              <button
                type="button"
                onClick={clearInput}
                className="rounded-lg border border-[#c5d8df] px-3 py-1.5 text-xs font-semibold text-[#3a5f6d] transition hover:bg-[#edf5f8]"
              >
                Clear input
              </button>
            </div>

            <label className="mt-5 block text-sm font-medium text-[#36505b]" htmlFor="email-content">
              Email content
            </label>
            <textarea
              id="email-content"
              className="mt-2 h-56 w-full rounded-xl border border-[#c7d8de] bg-[#fbfdff] px-4 py-3 text-sm text-[#1e3a45] outline-none ring-[#2f7d93] transition focus:ring-2"
              placeholder="Paste the quote email body here..."
              value={pastedContent}
              onChange={(event) => setPastedContent(event.target.value)}
            />
            <p className="mt-2 text-xs text-[#57707a]">{pastedContent.length.toLocaleString()} characters</p>

            <div className="mt-4">
              <p className="text-sm font-medium text-[#36505b]">Pasted format</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {PASTE_FORMAT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPastedFormat(option.value)}
                    className={`rounded-full px-3 py-1.5 text-sm transition ${
                      pastedFormat === option.value
                        ? "bg-[#1c6175] text-white"
                        : "bg-[#edf5f8] text-[#35606f] hover:bg-[#dcebf0]"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <label className="block text-sm font-medium text-[#36505b]" htmlFor="file-upload">
                Upload files (.pdf, .html, .txt)
              </label>

              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`mt-2 rounded-xl border-2 border-dashed px-4 py-6 transition ${
                  dragActive
                    ? "border-[#1f7088] bg-[#ecf7fb]"
                    : "border-[#c7d8de] bg-[#fbfdff]"
                }`}
              >
                <p className="text-sm font-medium text-[#2b5564]">Drag and drop quote files here</p>
                <p className="mt-1 text-xs text-[#5d7883]">or pick files manually</p>
                <input
                  id="file-upload"
                  type="file"
                  multiple
                  accept=".pdf,.html,.htm,.txt,text/html,text/plain,application/pdf"
                  className="mt-3 block w-full rounded-xl border border-[#c7d8de] bg-white px-3 py-2 text-sm text-[#264653] file:mr-4 file:rounded-md file:border-0 file:bg-[#1f6b80] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#245e6f]"
                  onChange={handleFileChange}
                />
              </div>
            </div>

            {selectedFiles.length > 0 ? (
              <div className="mt-3 rounded-xl border border-[#d7e5ea] bg-[#f7fbfd] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#4d6871]">
                  {selectedFiles.length} file{selectedFiles.length === 1 ? "" : "s"} queued
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedFiles.map((file, index) => (
                    <div
                      key={fileIdentity(file)}
                      className="inline-flex items-center gap-2 rounded-full border border-[#c8d9df] bg-white px-2.5 py-1.5 text-xs text-[#35515d]"
                    >
                      <span>{file.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(index)}
                        className="rounded-full bg-[#e7f1f4] px-1.5 py-0.5 font-bold text-[#365f6d] hover:bg-[#d6e8ee]"
                        aria-label={`Remove ${file.name}`}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            {notice ? <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">{notice}</p> : null}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={!hasInput || isSubmitting}
                className="flex-1 rounded-xl bg-[#0f4f63] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#164557] disabled:cursor-not-allowed disabled:bg-[#9cb4bd]"
              >
                {isSubmitting ? "Parsing quote..." : "Parse quote"}
              </button>
              <button
                type="button"
                onClick={clearResults}
                disabled={results.length === 0}
                className="rounded-xl border border-[#c6d7dd] px-4 py-3 text-sm font-semibold text-[#3f6370] transition hover:bg-[#edf5f8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear results
              </button>
            </div>
          </form>

          <aside className="rounded-2xl border border-[#d6e5e9] bg-white p-6 shadow-[0_22px_65px_-50px_rgba(15,23,42,0.9)]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[#173742]">Results</h2>
              {activeResult ? (
                <button
                  type="button"
                  onClick={copyResultJson}
                  className="rounded-lg border border-[#c5d8df] px-3 py-1.5 text-xs font-semibold text-[#355a68] transition hover:bg-[#edf5f8]"
                >
                  Copy JSON
                </button>
              ) : null}
            </div>

            {results.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-[#c6d7dc] bg-[#f9fcfd] p-5 text-sm text-[#4f646c]">
                Parse a quote to view extracted totals and evidence.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  {results.map((result, index) => (
                    <button
                      key={`${result.sourceName}-${index}`}
                      type="button"
                      onClick={() => setActiveResultIndex(index)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        index === activeResultIndex
                          ? "bg-[#154d60] text-white"
                          : "bg-[#edf5f8] text-[#3c5f6c] hover:bg-[#dfecf1]"
                      }`}
                    >
                      {result.sourceName}
                    </button>
                  ))}
                </div>

                {activeResult ? (
                  <article className="rounded-xl bg-[#f8fbfc] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-[#1d4450]">{activeResult.sourceName}</h3>
                      {activeResult.saved ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          Saved
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                          Local only
                        </span>
                      )}
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-lg border border-[#d8e6ea] bg-white px-3 py-2 text-xs text-[#48636d]">
                        Fields found: <span className="font-semibold">{activeResultFoundFields}/4</span>
                      </div>
                      <div className="rounded-lg border border-[#d8e6ea] bg-white px-3 py-2 text-xs text-[#48636d]">
                        Warnings: <span className="font-semibold">{activeResult.warnings.length}</span>
                      </div>
                      <div className="rounded-lg border border-[#d8e6ea] bg-white px-3 py-2 text-xs text-[#48636d]">
                        Coverage: <span className="font-semibold">{Math.round((activeResultFoundFields / REQUIRED_FIELDS_COUNT) * 100)}%</span>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {QUOTE_FIELD_ORDER.map((key) => (
                        <FieldCard key={`${activeResult.sourceName}-${key}`} field={activeResult.fields[key]} />
                      ))}
                    </div>

                    {activeResult.warnings.length > 0 ? (
                      <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {activeResult.warnings.map((warning) => (
                          <li key={warning}>- {warning}</li>
                        ))}
                      </ul>
                    ) : null}

                    {activeResult.normalizedTextPreview ? (
                      <details className="mt-4 rounded-lg border border-[#d8e6ea] bg-white px-3 py-2 text-xs text-[#4f6670]">
                        <summary className="cursor-pointer font-semibold text-[#375c69]">Normalized text preview</summary>
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-mono leading-relaxed">
                          {activeResult.normalizedTextPreview}
                        </pre>
                      </details>
                    ) : null}
                  </article>
                ) : null}
              </div>
            )}
          </aside>
        </section>

        <section className="rounded-2xl border border-[#d6e5e9] bg-white p-6 shadow-[0_22px_65px_-50px_rgba(15,23,42,0.9)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#173742]">Recent Parsed Quotes</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="Filter by source"
                className="rounded-lg border border-[#c2d4db] px-3 py-1.5 text-sm text-[#22424d] outline-none ring-[#2f7d93] transition focus:ring-2"
              />
              <button
                type="button"
                onClick={() => void refreshHistory()}
                className="rounded-lg border border-[#bbd0d8] px-3 py-1.5 text-sm text-[#2a5868] transition hover:bg-[#eef6f8]"
              >
                {isLoadingHistory ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <p className="mt-3 text-xs text-[#5b737c]">
            Showing {filteredHistoryRows.length} of {historyRows.length} saved rows.
          </p>

          <div className="mt-4">
            <HistoryTable rows={filteredHistoryRows} />
          </div>
        </section>
      </section>
    </main>
  );
}
