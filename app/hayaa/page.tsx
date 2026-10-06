"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { readFileAsArrayBuffer } from "@/lib/tasfya/orderExcel";
import { parseCardPdf, type ParsedCard } from "@/lib/hayaa/parseCard";
import {
  buildReportWorkbook,
  reportRowValues,
  selectReportRows,
  TRANSFER_OUT,
  type ReportSelection,
  type ReportStyle,
} from "@/lib/hayaa/report";

type ParseState =
  | { status: "loading" }
  | { status: "done"; card: ParsedCard }
  | { status: "error"; message: string };

/** Same file picked twice (name + size + mtime) is kept only once. */
function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** The uploaded PDF's name with an .xlsx extension. */
function xlsxName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, "")}.xlsx`;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** ISO yyyy-mm-dd → d/m/yyyy (how the reports show dates). */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
}

/** Short two-note chime so a finished download is noticed even off-screen. */
function playChime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.18;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // no audio available — the banner is enough
  }
}

/** Tab-separated text that pastes into Google Sheets as cells. */
function toTsv(rows: Array<Array<string | number>>): string {
  return rows
    .map((r) => r.map((v) => String(v).replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\n");
}

function cardPeriod(card: ParsedCard): string {
  if (!card.movements.length) return "—";
  const dates = card.movements.map((m) => m.docDate).sort();
  return `${formatDate(dates[0])} → ${formatDate(dates[dates.length - 1])}`;
}

export default function HayaaPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [parsed, setParsed] = useState<Record<string, ParseState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showMovements, setShowMovements] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Excel export settings. No style until the user picks one.
  const [style, setStyle] = useState<ReportStyle | null>(null);
  const [manufacturer, setManufacturer] = useState("");
  const [maxPerDay, setMaxPerDay] = useState(10);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [downloading, setDownloading] = useState(false);
  // Result of the last "download all" (shown as a big confirmation banner).
  const [downloadDone, setDownloadDone] = useState<{
    count: number;
    folder: string | null;
  } | null>(null);
  const [copied, setCopied] = useState<"rows" | "totals" | null>(null);

  // While the banner is up, the tab title says so too (visible from other tabs).
  useEffect(() => {
    if (!downloadDone) return;
    const prev = document.title;
    document.title = `✅ تم التحميل (${downloadDone.count})`;
    return () => {
      document.title = prev;
    };
  }, [downloadDone]);

  /** Report rows per parsed file, under the current settings. */
  const selections = useMemo(() => {
    const out: Record<string, ReportSelection> = {};
    for (const [key, state] of Object.entries(parsed)) {
      if (state.status !== "done") continue;
      out[key] = selectReportRows(state.card, Math.max(1, maxPerDay), {
        from: dateFrom || undefined,
        to: dateTo || undefined,
      });
    }
    return out;
  }, [parsed, maxPerDay, dateFrom, dateTo]);

  /** The finished Excel for one file, or null if it has nothing to export. */
  async function buildReport(
    file: File,
  ): Promise<{ name: string; buffer: ArrayBuffer } | null> {
    const key = fileKey(file);
    const state = parsed[key];
    const sel = selections[key];
    if (!style || state?.status !== "done" || !sel?.rows.length) return null;
    const buffer = await buildReportWorkbook(state.card, sel.rows, {
      style,
      manufacturer,
    });
    return { name: xlsxName(file.name), buffer };
  }

  function saveViaBrowser(name: string, buffer: ArrayBuffer) {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadReport(file: File) {
    const report = await buildReport(file);
    if (report) saveViaBrowser(report.name, report.buffer);
  }

  /**
   * Asks for a folder once and writes every Excel into it. Browsers without
   * the folder picker (Firefox/Safari) fall back to one download per file.
   */
  async function downloadAll() {
    const win = window as unknown as {
      showDirectoryPicker?: (opts: {
        mode: "readwrite";
      }) => Promise<FileSystemDirectoryHandle>;
    };

    let dir: FileSystemDirectoryHandle | null = null;
    if (win.showDirectoryPicker) {
      try {
        dir = await win.showDirectoryPicker({ mode: "readwrite" });
      } catch {
        return; // user cancelled the folder picker
      }
    }

    setDownloading(true);
    setDownloadDone(null);
    let count = 0;
    try {
      for (const file of files) {
        const report = await buildReport(file);
        if (!report) continue;
        count++;
        if (dir) {
          const handle = await dir.getFileHandle(report.name, { create: true });
          const writable = await handle.createWritable();
          await writable.write(report.buffer);
          await writable.close();
        } else {
          saveViaBrowser(report.name, report.buffer);
          // Browsers drop rapid back-to-back downloads; space them out.
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      setDownloadDone({ count, folder: dir?.name ?? null });
      playChime();
    } finally {
      setDownloading(false);
    }
  }

  const downloadable = files.filter(
    (f) => (selections[fileKey(f)]?.rows.length ?? 0) > 0,
  ).length;

  /** Per file: item + total الكمية المباعة of the rows that go in the sheet. */
  const totals = files.flatMap((file) => {
    const key = fileKey(file);
    const state = parsed[key];
    const sel = selections[key];
    if (state?.status !== "done" || !sel) return [];
    return [
      {
        key,
        card: state.card,
        rows: sel.rows.length,
        qty: sel.rows.reduce((s, r) => s + r.movement.qtyOut, 0),
      },
    ];
  });
  const grandTotal = totals.reduce((s, t) => s + t.qty, 0);

  async function copyText(text: string, what: "rows" | "totals") {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
  }

  /** Every file's sheet rows stacked, without the م column, ready to paste. */
  function copyAllRows() {
    if (!style) return;
    const all: Array<Array<string | number>> = [];
    for (const file of files) {
      const key = fileKey(file);
      const state = parsed[key];
      const sel = selections[key];
      if (state?.status !== "done" || !sel?.rows.length) continue;
      const values = reportRowValues(state.card, sel.rows, {
        style,
        manufacturer,
      });
      all.push(...values.map((row) => row.slice(1)));
    }
    copyText(toTsv(all), "rows");
  }

  function copyTotals() {
    copyText(
      toTsv(
        totals.map((t) => [
          t.card.code,
          t.card.productName || t.card.itemName,
          t.card.priceTag,
          t.qty,
        ]),
      ),
      "totals",
    );
  }

  async function parseFile(file: File) {
    const key = fileKey(file);
    setParsed((p) => ({ ...p, [key]: { status: "loading" } }));
    try {
      const card = await parseCardPdf(await readFileAsArrayBuffer(file));
      setParsed((p) => ({ ...p, [key]: { status: "done", card } }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setParsed((p) => ({ ...p, [key]: { status: "error", message } }));
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    setRejected(incoming.filter((f) => !isPdf(f)).map((f) => f.name));
    const seen = new Set(files.map(fileKey));
    const added = incoming.filter((f) => {
      const key = fileKey(f);
      if (!isPdf(f) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!added.length) return;
    setFiles((prev) => [...prev, ...added]);
    if (!selected) setSelected(fileKey(added[0]));
    added.forEach(parseFile);
  }

  function removeFile(key: string) {
    setFiles((prev) => prev.filter((f) => fileKey(f) !== key));
    setParsed(({ [key]: _, ...rest }) => rest);
    if (selected === key) setSelected(null);
  }

  function clearAll() {
    setFiles([]);
    setParsed({});
    setSelected(null);
  }

  const selectedState = selected ? parsed[selected] : undefined;
  const selectedCard =
    selectedState?.status === "done" ? selectedState.card : null;

  const visibleMovements = useMemo(() => {
    if (!selectedCard) return [];
    return selectedCard.movements.filter((m) => m.docType === TRANSFER_OUT);
  }, [selectedCard]);

  return (
    <div dir="rtl" className="mx-auto w-full max-w-7xl space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الهيئة</h1>
          <p className="text-2xl font-bold tracking-tight">
            ارفع ملف أو أكثر من كارت حركة الصنف (PDF).
          </p>
        </div>
        {files.length > 0 && (
          <Button variant="outline" onClick={clearAll}>
            <X />
            مسح الكل
          </Button>
        )}
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-10 text-center transition-colors hover:bg-muted/40",
          dragging && "border-primary bg-muted/60",
        )}
      >
        <Upload className="size-8 text-muted-foreground" />
        <p className="font-medium">اسحب ملفات PDF هنا أو اضغط للاختيار</p>
        <p className="text-xs text-muted-foreground">يمكن اختيار أكثر من ملف</p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            // Reset so picking the same file again still fires onChange.
            e.target.value = "";
          }}
        />
      </div>

      {rejected.length > 0 && (
        <p className="text-sm text-red-600 dark:text-red-400">
          تم تجاهل ملفات ليست PDF: {rejected.join("، ")}
        </p>
      )}

      {/* Excel export settings */}
      {files.length > 0 && (
        <div className="space-y-4 rounded-xl border border-border p-4">
          <h2 className="font-semibold">تحميل Excel</h2>

          <div className="space-y-2">
            <p className="text-sm font-medium">1. اختر شكل الشيت</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  [
                    "gaptin",
                    "GAPTIN",
                    "14 عمود · GLN المخزن · Batch · الرخصة · GLN الصيدلية · التاريخ 10/8/2026",
                    "بيتم اضافة الكود المكانى لكل فرع",
                  ],
                  [
                    "averozolid",
                    "AVEROZOLID",
                    "10 أعمدة · اسم الفرع المورد · بدون GLN · التاريخ 2026/08/14",
                    null,
                  ],
                ] as const
              ).map(([value, title, desc, note]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStyle(value)}
                  className={cn(
                    "rounded-lg border-2 border-border p-3 text-start transition-colors hover:bg-muted/40",
                    style === value && "border-primary bg-muted/60",
                  )}
                >
                  <p dir="ltr" className="text-end font-semibold">
                    {title}
                  </p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                  {note && (
                    <p className="mt-1.5 text-sm font-bold text-foreground">
                      {note}
                    </p>
                  )}
                </button>
              ))}
            </div>
            {!style && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                اختر شكل الشيت قبل التحميل.
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-medium">الشركة صاحبة المستحضر</span>
              <input
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                disabled={!style}
                className="h-9 w-full rounded-md border border-border bg-background px-3 disabled:opacity-50"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">من تاريخ</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">إلى تاريخ</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">أقصى عدد فروع في اليوم</span>
              <input
                type="number"
                min={1}
                value={maxPerDay}
                onChange={(e) => setMaxPerDay(Number(e.target.value) || 1)}
                className="h-9 w-full rounded-md border border-border bg-background px-3"
              />
            </label>
            <div className="flex items-end text-xs text-muted-foreground sm:col-span-3">
              {dateFrom || dateTo ? (
                <button
                  type="button"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="underline hover:text-foreground"
                >
                  إلغاء الفترة (تحميل كل ما في الملف)
                </button>
              ) : (
                "بدون تحديد فترة = كل التواريخ الموجودة في الملف."
              )}
            </div>
          </div>
        </div>
      )}

      {/* File list with per-file summary */}
      {files.length > 0 && (
        <div className="rounded-xl border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
            <span className="text-sm font-medium">
              الملفات المرفوعة ({files.length})
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={copyAllRows}
                disabled={!style || downloadable === 0}
                title={
                  !style
                    ? "اختر شكل الشيت أولاً"
                    : "نسخ صفوف كل الملفات (بدون العناوين) للصق في Google Sheets"
                }
              >
                {copied === "rows" ? <Check /> : <ClipboardCopy />}
                {copied === "rows" ? "تم النسخ" : "نسخ الكل للشيت"}
              </Button>
              <Button
                size="sm"
                onClick={downloadAll}
                disabled={!style || downloadable === 0 || downloading}
                title={!style ? "اختر شكل الشيت أولاً" : undefined}
              >
                {downloading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}
                {downloading
                  ? "جاري التحميل..."
                  : `تحميل الكل (${downloadable} ملف)`}
              </Button>
            </div>
          </div>
          {downloadDone && (
            <div className="flex items-center gap-3 border-b-2 border-emerald-500 bg-emerald-100 px-4 py-4 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
              <CheckCircle2 className="size-8 shrink-0" />
              <div className="flex-1">
                <p className="text-lg font-bold">
                  تم الانتهاء من التحميل — {downloadDone.count} ملف
                </p>
                {downloadDone.folder && (
                  <p className="text-sm">
                    تم الحفظ في فولدر:{" "}
                    <span dir="auto" className="font-semibold">
                      {downloadDone.folder}
                    </span>
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDownloadDone(null)}
                aria-label="إغلاق"
              >
                <X />
              </Button>
            </div>
          )}
          <ul className="divide-y divide-border">
            {files.map((file, idx) => {
              const key = fileKey(file);
              const state = parsed[key];
              const card = state?.status === "done" ? state.card : null;
              const sel = selections[key];
              const transfers =
                card?.movements.filter((m) => m.docType === TRANSFER_OUT)
                  .length ?? 0;
              return (
                <li
                  key={key}
                  onClick={() => setSelected(key)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40",
                    selected === key && "bg-muted/60",
                  )}
                >
                  <span className="w-6 text-sm tabular-nums text-muted-foreground">
                    {idx + 1}
                  </span>
                  <FileText className="size-4 shrink-0 text-red-600 dark:text-red-400" />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-sm">
                      {file.name}
                    </p>
                    {state?.status === "loading" && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        جاري القراءة...
                      </p>
                    )}
                    {state?.status === "error" && (
                      <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                        <AlertCircle className="size-3" />
                        تعذرت قراءة الملف: {state.message}
                      </p>
                    )}
                    {card && (
                      <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground tabular-nums">
                          {card.code || "بدون كود"}
                        </span>
                        <span dir="ltr">{card.productName}</span>
                        {card.priceTag && <span>{card.priceTag}</span>}
                        <span dir="ltr" className="tabular-nums">
                          {cardPeriod(card)}
                        </span>
                        <span>
                          {card.movements.length} حركة · {transfers} صرف تبادل
                        </span>
                        <span className="font-medium text-foreground">
                          {sel?.rows.length ?? 0} صف في الشيت
                        </span>
                      </p>
                    )}
                    {sel && sel.unmatched.size > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        غير موجود في ملف الفروع (لن يظهر في الشيت):{" "}
                        {[...sel.unmatched]
                          .map(([name, n]) => `${name} (${n})`)
                          .join("، ")}
                      </p>
                    )}
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatSize(file.size)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!style || !sel?.rows.length}
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadReport(file);
                    }}
                  >
                    <Download />
                    Excel
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(key);
                    }}
                    aria-label={`حذف ${file.name}`}
                  >
                    <X />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Total الكمية المباعة per item (rows that go in the sheet) */}
      {totals.length > 0 && (
        <div className="rounded-xl border border-border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
            <span className="text-sm font-medium">
              إجمالي الكمية المباعة لكل صنف
            </span>
            <Button size="sm" variant="outline" onClick={copyTotals}>
              {copied === "totals" ? <Check /> : <ClipboardCopy />}
              {copied === "totals" ? "تم النسخ" : "نسخ الإجماليات"}
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {["م", "الكود", "الصنف", "عدد الصفوف", "الكمية المباعة"].map(
                  (h) => (
                    <th
                      key={h}
                      className="border-b border-border px-3 py-2 text-center text-xs font-semibold text-muted-foreground"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {totals.map((t, idx) => (
                <tr
                  key={t.key}
                  className="border-b border-border/60 hover:bg-muted/40"
                >
                  <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                    {idx + 1}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    {t.card.code || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span dir="ltr">
                      {t.card.productName || t.card.itemName}
                    </span>
                    {t.card.priceTag && (
                      <span className="ms-2 text-xs text-muted-foreground">
                        {t.card.priceTag}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    {t.rows}
                  </td>
                  <td className="px-3 py-2 text-center font-semibold tabular-nums">
                    {t.qty.toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/50 font-bold">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-start">
                  الإجمالي
                </td>
                <td className="px-3 py-2 text-center tabular-nums">
                  {grandTotal.toLocaleString("en-US")}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Movements of the selected file */}
      {selectedCard && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              حركات{" "}
              <span dir="ltr">
                {selectedCard.productName || selectedCard.code}
              </span>{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({visibleMovements.length} صف)
              </span>
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMovements((v) => !v)}
            >
              {showMovements ? <EyeOff /> : <Eye />}
              {showMovements ? "إخفاء الحركات" : "إظهار الحركات"}
            </Button>
          </div>

          {showMovements && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {[
                    "م",
                    "تاريخ المستند",
                    "الوقت",
                    "نوع المستند",
                    "رقم المستند",
                    "جهة التعامل",
                    "الباتش",
                    "الصلاحية",
                    "وارد",
                    "منصرف",
                    "الرصيد",
                  ].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap border-b border-border px-3 py-2 text-center text-xs font-semibold text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleMovements.map((m, idx) => (
                  <tr
                    key={`${m.docNo}-${idx}`}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                      {idx + 1}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums">
                      {formatDate(m.docDate)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {m.time}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center">
                      {m.docType}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {m.docNo}
                    </td>
                    <td dir="auto" className="whitespace-nowrap px-3 py-2">
                      {m.partyArea && (
                        <span className="text-muted-foreground">
                          {m.partyArea} -{" "}
                        </span>
                      )}
                      {m.partyName}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {m.batch || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td
                      dir="ltr"
                      className="px-3 py-2 text-center tabular-nums"
                    >
                      {m.expiry}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {m.qtyIn || ""}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {m.qtyOut || ""}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {m.balance}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
