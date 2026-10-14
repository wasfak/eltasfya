"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  CheckCircle2,
  ClipboardCopy,
  Bookmark,
  BookmarkCheck,
  Building2,
  Database,
  Download,
  FileCode2,
  Loader2,
  Minus,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { matchBranch } from "@/lib/hayaa/branches";
import {
  itemToCard,
  mergeHtms,
  parseMovementHtm,
  type HtmItem,
  type ParsedHtm,
} from "@/lib/hayaa/parseHtm";
import { parseStockHtm } from "@/lib/hayaa/parseStock";
import {
  clearStock,
  loadStock,
  mergeStock,
  requestPersistentStorage,
  type StoredStockItem,
} from "@/lib/hayaa/stockStore";
import {
  clearSavedPicks,
  loadSavedPicks,
  productKey,
  saveSavedPicks,
  type SavedPick,
} from "@/lib/hayaa/savedPicks";
import {
  buildReportWorkbook,
  capReportRows,
  reportRowValues,
  selectReportRows,
} from "@/lib/hayaa/report";
import {
  playChime,
  saveAllReports,
  saveViaBrowser,
  toTsv,
  type Report,
} from "@/lib/hayaa/saveFiles";
import {
  DownloadDoneBanner,
  ReportSettings,
  type ReportSettingsValue,
} from "@/components/hayaa/report-settings";

/** The file being parsed right now, out of the batch the user dropped. */
type Loading = { file: File; progress: number; index: number; total: number };

/** A message about one file of the batch (rejected, already loaded). */
type Notice = { kind: "error" | "info"; text: string };

/** A movement file loaded this session (not saved — re-uploaded each visit). */
type LoadedHtm = { id: string; name: string; size: number; htm: ParsedHtm };

/** Company filter value for report codes the stock list doesn't know. */
const NO_COMPANY = "__none__";

/** How many items the list renders at once (the file can hold thousands). */
const LIST_LIMIT = 200;

function isHtm(file: File): boolean {
  return /\.html?$/i.test(file.name) || file.type === "text/html";
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** ISO yyyy-mm-dd → d/m/yyyy. */
function formatDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function itemQty(item: HtmItem): number {
  return item.lines.reduce((s, l) => s + l.qty, 0);
}

/** Item name without Arabic words, price tag or #..# markers. */
function displayName(item: HtmItem): string {
  return item.productName || item.itemName;
}

/** "<code> <product>.xlsx" without characters Windows forbids in names. */
function xlsxName(item: HtmItem): string {
  const name = `${item.code} ${displayName(item)}`;
  return `${name.replace(/[\\/:*?"<>|#]+/g, " ").replace(/\s+/g, " ").trim()}.xlsx`;
}


export default function UploadPage() {
  const [files, setFiles] = useState<LoadedHtm[]>([]);
  const [loading, setLoading] = useState<Loading | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [showPicked, setShowPicked] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // code → company from the stock files, saved in the browser; null while loading.
  const [stock, setStock] = useState<Map<string, StoredStockItem> | null>(null);
  const [stockBusy, setStockBusy] = useState(false);
  const [stockNotice, setStockNotice] = useState<Notice | null>(null);
  const stockInputRef = useRef<HTMLInputElement>(null);

  // Picks saved in the browser, to mark again on a later upload; null while loading.
  const [saved, setSaved] = useState<SavedPick[] | null>(null);
  const [savedNotice, setSavedNotice] = useState<Notice | null>(null);
  const [autoApply, setAutoApply] = useState(false);

  // Codes picked for export (in pick order) and the batch typed for each.
  const [picked, setPicked] = useState<string[]>([]);
  const [batches, setBatches] = useState<Record<string, string>>({});
  // Max total qty in each code's sheet ("" = no cap), and the "for all" box.
  const [caps, setCaps] = useState<Record<string, string>>({});
  const [capAll, setCapAll] = useState("");
  const [settings, setSettings] = useState<ReportSettingsValue>({
    style: null,
    manufacturer: "",
    maxPerDay: 10,
    dateFrom: "",
    dateTo: "",
  });
  const [downloading, setDownloading] = useState(false);
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

  // Read back the saved stock list, and ask the browser to never evict it.
  useEffect(() => {
    loadStock()
      .then(setStock)
      .catch((e) => {
        setStock(new Map());
        setStockNotice({
          kind: "error",
          text: `تعذرت قراءة الأرصدة المحفوظة: ${e instanceof Error ? e.message : String(e)}`,
        });
      });
    loadSavedPicks()
      .then(setSaved)
      .catch(() => setSaved([]))
      .finally(() => {
        try {
          setAutoApply(localStorage.getItem("hayaa-auto-picks") === "1");
        } catch {
          // no storage — the toggle just starts off
        }
      });
    requestPersistentStorage();
  }, []);

  async function loadFiles(dropped: File[]) {
    if (!dropped.length || loading) return;
    setDownloadDone(null);
    const out: Notice[] = [];
    const known = new Set(files.map((f) => f.id));
    const added: LoadedHtm[] = [];

    for (const [index, file] of dropped.entries()) {
      if (!isHtm(file)) {
        out.push({ kind: "error", text: `${file.name}: الملف ليس htm` });
        continue;
      }
      const id = `${file.name}|${file.size}|${file.lastModified}`;
      if (known.has(id)) {
        out.push({ kind: "info", text: `${file.name}: مرفوع بالفعل — تم تخطيه` });
        continue;
      }
      setLoading({ file, progress: 0, index, total: dropped.length });
      try {
        const htm = await parseMovementHtm(file, (progress) =>
          setLoading({ file, progress, index, total: dropped.length }),
        );
        known.add(id);
        const loaded = { id, name: file.name, size: file.size, htm };
        added.push(loaded);
        setFiles((f) => [...f, loaded]);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        out.push({ kind: "error", text: `تعذرت قراءة ${file.name}: ${message}` });
      }
    }
    setLoading(null);
    setNotices(out);
    // Mark the saved codes in the new data, if the user wants that.
    if (autoApply && added.length && saved?.length) {
      const all = mergeHtms([...files, ...added].map((f) => f.htm)).htm;
      applySaved(saved, [...all.items.values()]);
    }
  }

  function removeFile(id: string) {
    const remaining = files.filter((f) => f.id !== id);
    setFiles(remaining);
    // Drop picks whose code no longer exists in the remaining files.
    const codes = new Set(remaining.flatMap((f) => [...f.htm.items.keys()]));
    setPicked((p) => p.filter((c) => codes.has(c)));
    setSelected((c) => (c && codes.has(c) ? c : null));
    setDownloadDone(null);
  }

  function removeAll() {
    setFiles([]);
    setNotices([]);
    setQuery("");
    setCompany("");
    clearPicked();
    setSelected(null);
    setDownloadDone(null);
  }

  async function uploadStock(dropped: File[]) {
    if (!dropped.length || stockBusy) return;
    setStockBusy(true);
    setStockNotice(null);
    try {
      let added = 0;
      let updated = 0;
      let skipped = 0;
      for (const file of dropped) {
        if (!isHtm(file)) throw new Error(`${file.name}: الملف ليس htm`);
        const parsed = await parseStockHtm(file);
        await mergeStock(parsed.items);
        skipped += parsed.skipped;
        for (const i of parsed.items) {
          if (stock?.has(i.code)) updated++;
          else added++;
        }
      }
      setStock(await loadStock());
      setStockNotice({
        kind: skipped ? "error" : "info",
        text:
          `تم حفظ الأرصدة: ${fmt(added)} كود جديد · ${fmt(updated)} تم تحديثه` +
          (skipped ? ` · ${fmt(skipped)} صف بدون كود لم يُقرأ` : ""),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStockNotice({ kind: "error", text: `تعذر حفظ الأرصدة: ${message}` });
    } finally {
      setStockBusy(false);
    }
  }

  async function removeStock() {
    if (!window.confirm("حذف كل الأرصدة المحفوظة (الأكواد والشركات)؟")) return;
    try {
      await clearStock();
      setStock(new Map());
      setCompany("");
      setStockNotice(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStockNotice({ kind: "error", text: `تعذر الحذف: ${message}` });
    }
  }

  const merged = useMemo(
    () => (files.length ? mergeHtms(files.map((f) => f.htm)) : null),
    [files],
  );
  const htm = merged?.htm ?? null;
  const movementTypes = useMemo(
    () => new Set(files.map((f) => f.htm.movementType)),
    [files],
  );

  const companyOf = (code: string) => stock?.get(code)?.company ?? "";
  /** The item name exactly as the stock file has it (else as the movement file has it). */
  const nameOf = (item: HtmItem) => stock?.get(item.code)?.itemName || item.itemName;

  const stockCompanies = useMemo(
    () => new Set([...(stock?.values() ?? [])].map((i) => i.company)).size,
    [stock],
  );

  const items = useMemo(() => {
    if (!htm) return [];
    return [...htm.items.values()].sort((a, b) =>
      (stock?.get(a.code)?.itemName || a.itemName).localeCompare(
        stock?.get(b.code)?.itemName || b.itemName,
      ),
    );
  }, [htm, stock]);

  /** Companies of the report's codes, with how many codes each has. */
  const companies = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) {
      const c = stock?.get(i.code)?.company || NO_COMPANY;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) =>
      a === NO_COMPANY ? 1 : b === NO_COMPANY ? -1 : a.localeCompare(b),
    );
  }, [items, stock]);

  const selectedItem = selected ? htm?.items.get(selected) ?? null : null;
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  // "Show picked only" switches itself off once nothing is picked.
  const pickedOnly = showPicked && picked.length > 0;

  const filtered = useMemo(() => {
    let base = pickedOnly ? items.filter((i) => pickedSet.has(i.code)) : items;
    if (company) {
      base = base.filter(
        (i) => (stock?.get(i.code)?.company || NO_COMPANY) === company,
      );
    }
    const q = query.trim().toUpperCase();
    if (!q) return base;
    return base.filter(
      (i) =>
        i.code.includes(q) ||
        i.itemName.toUpperCase().includes(q) ||
        (stock?.get(i.code)?.itemName.toUpperCase().includes(q) ?? false) ||
        (stock?.get(i.code)?.company.toUpperCase().includes(q) ?? false),
    );
  }, [items, query, company, stock, pickedOnly, pickedSet]);

  function clearPicked() {
    setPicked([]);
    setShowPicked(false);
  }

  /** Picks every item the search / company filter currently shows. */
  function markAll() {
    setPicked((p) => {
      const have = new Set(p);
      return [...p, ...filtered.map((i) => i.code).filter((c) => !have.has(c))];
    });
  }

  function togglePick(code: string) {
    setPicked((p) =>
      p.includes(code) ? p.filter((c) => c !== code) : [...p, code],
    );
  }

  /** Marks the saved codes, plus new price-generation codes of the same product. */
  function applySaved(list: SavedPick[] = saved ?? [], within: HtmItem[] = items) {
    if (!list.length || !within.length) return;
    const codes = new Set(list.map((p) => p.code));
    const keys = new Set(list.map((p) => productKey(p.productName)).filter(Boolean));
    const hits = within.filter(
      (i) => codes.has(i.code) || (!!i.productName && keys.has(productKey(i.productName))),
    );
    const found = new Set(hits.flatMap((i) => [i.code, productKey(i.productName)]));
    const missing = list.filter(
      (p) => !found.has(p.code) && !found.has(productKey(p.productName)),
    ).length;
    setPicked((p) => [...p, ...hits.map((i) => i.code).filter((c) => !p.includes(c))]);
    setSavedNotice({
      kind: "info",
      text:
        `تم تحديد ${fmt(hits.length)} صنف من المحفوظ` +
        (missing ? ` · ${fmt(missing)} كود محفوظ غير موجود في الملفات` : ""),
    });
  }

  async function savePicks() {
    if (!htm || !picked.length) return;
    if (
      saved?.length &&
      !window.confirm(`استبدال الأكواد المحفوظة (${saved.length}) بالمختار الحالي (${picked.length})؟`)
    ) {
      return;
    }
    const list = picked.map((code) => ({
      code,
      productName: htm.items.get(code)?.productName ?? "",
    }));
    try {
      await saveSavedPicks(list);
      setSaved(list);
      setSavedNotice({ kind: "info", text: `تم حفظ ${fmt(list.length)} كود` });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setSavedNotice({ kind: "error", text: `تعذر الحفظ: ${message}` });
    }
  }

  async function removeSaved() {
    if (!window.confirm("حذف الأكواد المحفوظة؟")) return;
    try {
      await clearSavedPicks();
      setSaved([]);
      setSavedNotice(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setSavedNotice({ kind: "error", text: `تعذر الحذف: ${message}` });
    }
  }

  function toggleAutoApply(on: boolean) {
    setAutoApply(on);
    try {
      localStorage.setItem("hayaa-auto-picks", on ? "1" : "0");
    } catch {
      // not remembered — fine for this session
    }
  }

  /** Each picked code as a hayaa card + the rows that go in its sheet. */
  const exports = useMemo(() => {
    if (!htm) return [];
    const { maxPerDay, dateFrom, dateTo } = settings;
    return picked.flatMap((code) => {
      const item = htm.items.get(code);
      if (!item) return [];
      const batch = batches[code]?.trim() ?? "";
      const card = itemToCard(htm, item, batch);
      const all = selectReportRows(card, Math.max(1, maxPerDay), {
        from: dateFrom || undefined,
        to: dateTo || undefined,
      });
      const fullQty = all.rows.reduce((s, r) => s + r.movement.qtyOut, 0);
      const rows = capReportRows(all.rows, caps[code] ?? "");
      const qty = rows.reduce((s, r) => s + r.movement.qtyOut, 0);
      const sel = { ...all, rows };
      return [{ item, card, sel, qty, fullQty, batch }];
    });
  }, [htm, picked, batches, caps, settings]);

  type Export = (typeof exports)[number];

  const downloadable = exports.filter((e) => e.sel.rows.length > 0).length;
  const grandQty = exports.reduce((s, e) => s + e.qty, 0);
  const missingBatch =
    !!settings.style &&
    exports.some((e) => e.sel.rows.length > 0 && !e.batch);

  async function buildReport(e: Export): Promise<Report | null> {
    const { style, manufacturer } = settings;
    if (!style || !e.sel.rows.length) return null;
    const buffer = await buildReportWorkbook(e.card, e.sel.rows, {
      style,
      manufacturer,
    });
    return { name: xlsxName(e.item), buffer };
  }

  async function downloadOne(e: Export) {
    const report = await buildReport(e);
    if (report) saveViaBrowser(report.name, report.buffer);
  }

  async function downloadAll() {
    setDownloading(true);
    setDownloadDone(null);
    try {
      const done = await saveAllReports(exports.map((e) => () => buildReport(e)));
      if (done) {
        setDownloadDone(done);
        playChime();
      }
    } finally {
      setDownloading(false);
    }
  }

  async function copyText(text: string, what: "rows" | "totals") {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
  }

  /** Every picked code's sheet rows stacked, without the م column. */
  function copyAllRows() {
    const { style, manufacturer } = settings;
    if (!style) return;
    const all = exports.flatMap((e) =>
      reportRowValues(e.card, e.sel.rows, { style, manufacturer }),
    );
    copyText(toTsv(all), "rows");
  }

  function copyTotals() {
    copyText(
      toTsv(
        exports.map((e) => [
          e.item.code,
          displayName(e.item),
          e.qty,
        ]),
      ),
      "totals",
    );
  }

  return (
    <div dir="rtl" className="mx-auto w-full max-w-[1800px] space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">رفع سجل الحركة</h1>
        {files.length > 0 && !loading && (
          <Button variant="outline" onClick={removeAll}>
            <X />
            مسح الملفات
          </Button>
        )}
      </div>

      {/* Stock list (code → company), saved in the browser */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3 text-sm">
        <Building2 className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">ملف الأرصدة (الشركات)</p>
          <p className="text-xs text-muted-foreground">
            {stock === null
              ? "جاري التحميل..."
              : stock.size === 0
                ? "لا توجد أرصدة محفوظة — ارفع ملف الأرصدة لربط الأكواد بالشركات."
                : `محفوظ: ${fmt(stock.size)} كود · ${fmt(stockCompanies)} شركة`}
          </p>
          {stockNotice && (
            <p
              className={cn(
                "text-xs",
                stockNotice.kind === "error"
                  ? "text-red-600 dark:text-red-400"
                  : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {stockNotice.text}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={stock === null || stockBusy}
          onClick={() => stockInputRef.current?.click()}
        >
          {stockBusy ? <Loader2 className="animate-spin" /> : <Upload />}
          رفع ملف الأرصدة
        </Button>
        {stock && stock.size > 0 && (
          <Button size="sm" variant="ghost" onClick={removeStock}>
            <Trash2 />
            حذف الأرصدة
          </Button>
        )}
        <input
          ref={stockInputRef}
          type="file"
          multiple
          accept=".htm,.html,text/html"
          className="hidden"
          onChange={(e) => {
            uploadStock([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {/* Drop zone */}
      {!loading && (
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
            loadFiles([...e.dataTransfer.files]);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-10 text-center transition-colors hover:bg-muted/40",
            dragging && "border-primary bg-muted/60",
          )}
        >
          <Upload className="size-8 text-muted-foreground" />
          <p className="font-medium">
            {htm
              ? "أضف ملفات htm أخرى"
              : "اسحب ملفات htm هنا أو اضغط للاختيار"}
          </p>
          <p className="text-xs text-muted-foreground">
            يمكن اختيار أكثر من ملف
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".htm,.html,text/html"
            className="hidden"
            onChange={(e) => {
              loadFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {loading && (
        <div
          role="status"
          className="flex flex-col items-center gap-4 rounded-xl border-2 border-primary/40 bg-muted/40 p-10 text-center"
        >
          <Loader2 className="size-12 animate-spin text-primary" />
          <div className="space-y-1">
            <p className="text-lg font-semibold">
              جاري قراءة الملف
              {loading.total > 1 && ` ${loading.index + 1} من ${loading.total}`}
              ... برجاء الانتظار
            </p>
            <p dir="auto" className="text-sm text-muted-foreground">
              {loading.file.name}
            </p>
          </div>
          <div className="h-3 w-full max-w-xl overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.round(loading.progress * 100)}%` }}
            />
          </div>
          <p className="text-2xl font-bold tabular-nums">
            {Math.round(loading.progress * 100)}%
          </p>
          <p className="text-sm tabular-nums text-muted-foreground">
            {formatSize(loading.file.size * loading.progress)} من{" "}
            {formatSize(loading.file.size)}
          </p>
        </div>
      )}

      {notices.length > 0 && (
        <div className="space-y-1">
          {notices.map((n, i) => (
            <p
              key={i}
              dir="auto"
              className={cn(
                "flex items-center gap-2 text-sm",
                n.kind === "error"
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground",
              )}
            >
              <AlertCircle className="size-4 shrink-0" />
              {n.text}
            </p>
          ))}
        </div>
      )}

      {/* Loaded files + merged summary */}
      {files.length > 0 && htm && merged && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 font-semibold">
              <Database className="size-4 text-muted-foreground" />
              الملفات المرفوعة ({files.length})
            </p>
          </div>

          <ul className="divide-y divide-border rounded-lg border border-border">
            {files.map((s) => {
              // A totals gap comes from SofTech's own sums (shown below in grey), not from us.
              const ok = s.htm.unknownRows === 0;
              return (
                <li key={s.id} className="space-y-1 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                    <span dir="auto" className="font-medium">
                      {s.name}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatSize(s.size)} · {formatDate(s.htm.from)} →{" "}
                      {formatDate(s.htm.to)} · {fmt(s.htm.docs)} مستند ·{" "}
                      {fmt(s.htm.lines)} سطر
                    </span>
                    {ok ? (
                      <CheckCircle2
                        className="size-4 text-emerald-600 dark:text-emerald-400"
                        aria-label="تمت قراءة الملف بالكامل"
                      />
                    ) : (
                      <AlertCircle className="size-4 text-red-600 dark:text-red-400" />
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ms-auto"
                      onClick={() => removeFile(s.id)}
                      aria-label={`حذف ${s.name}`}
                    >
                      <X />
                    </Button>
                  </div>
                  {s.htm.unknownRows > 0 && (
                    <div className="space-y-0.5 text-xs text-red-600 dark:text-red-400">
                      <p className="font-medium">
                        {fmt(s.htm.unknownRows)} صف غير مفهوم — قد تكون بعض الحركات ناقصة.
                      </p>
                      {s.htm.unknownSamples.map((vals, i) => (
                        <p key={i} dir="auto">
                          {vals.join(" | ")}
                        </p>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="grid gap-3 text-sm sm:grid-cols-3">
            {[
              ["نوع الحركة", htm.movementType || "—"],
              ["الفترة (كل الملفات)", `${formatDate(htm.from)} → ${formatDate(htm.to)}`],
              ["الإجمالي", `${fmt(htm.items.size)} صنف · ${fmt(htm.lines)} سطر`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          {merged.duplicateLines > 0 && (
            <p className="text-xs text-muted-foreground">
              تم تجاهل {fmt(merged.duplicateLines)} سطر مكرر (نفس المستند موجود في
              أكثر من ملف) — كل مستند محسوب مرة واحدة.
            </p>
          )}
          {movementTypes.size > 1 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              الملفات فيها أكثر من نوع حركة: {[...movementTypes].join("، ")}
            </p>
          )}
        </div>
      )}

      {/* Item picker + detail */}
      {htm && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="rounded-xl border border-border">
            <div className="border-b border-border p-3">
              <div className="flex flex-wrap gap-2">
                <label className="relative block min-w-40 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="ابحث بالكود أو اسم الصنف أو الشركة"
                    className="h-9 w-full rounded-md border border-border bg-background ps-9 pe-3"
                  />
                </label>
                <select
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  aria-label="فلتر الشركة"
                  className={cn(
                    "h-9 max-w-52 rounded-md border border-border bg-background px-2",
                    company && "border-primary",
                  )}
                >
                  <option value="">كل الشركات</option>
                  {companies.map(([c, n]) => (
                    <option key={c} value={c}>
                      {c === NO_COMPANY ? "بدون شركة" : c} ({fmt(n)})
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {fmt(filtered.length)} صنف
                {filtered.length > LIST_LIMIT &&
                  ` — يظهر أول ${LIST_LIMIT}، اكتب للبحث`}
                {" · "}علّم ✓ على الأصناف المطلوبة في الشيت
              </p>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-1.5 text-sm">
                <button
                  type="button"
                  onClick={() => setShowPicked((v) => !v)}
                  disabled={picked.length === 0}
                  title={
                    pickedOnly ? "عرض كل الأصناف" : "عرض الأصناف المختارة فقط"
                  }
                  className={cn(
                    "rounded-md px-2 py-0.5 transition-colors enabled:hover:bg-background disabled:opacity-60",
                    pickedOnly && "bg-primary text-primary-foreground enabled:hover:bg-primary/90",
                  )}
                >
                  المختار:{" "}
                  <span className="font-semibold tabular-nums">
                    {fmt(picked.length)}
                  </span>{" "}
                  صنف
                  {pickedOnly && " · عرض الكل"}
                </button>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={markAll}
                    disabled={filtered.every((i) => pickedSet.has(i.code))}
                    title="تحديد كل الأصناف الظاهرة حسب البحث وفلتر الشركة"
                  >
                    <CheckCheck />
                    تحديد الكل ({fmt(filtered.length)})
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearPicked}
                    disabled={picked.length === 0}
                  >
                    <X />
                    إلغاء تحديد الكل
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-3 py-1.5 text-sm">
                <Bookmark className="size-4 shrink-0 text-muted-foreground" />
                <span className="me-auto">
                  المحفوظ:{" "}
                  <span className="font-semibold tabular-nums">
                    {fmt(saved?.length ?? 0)}
                  </span>{" "}
                  كود
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => applySaved()}
                  disabled={!saved?.length}
                  title="تحديد الأكواد المحفوظة (وأكوادها الجديدة بعد تغيير السعر)"
                >
                  <BookmarkCheck />
                  تحديد المحفوظ
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={savePicks}
                  disabled={picked.length === 0}
                  title="حفظ الأصناف المختارة لتحديدها في ملفات لاحقة"
                >
                  <Save />
                  حفظ المختار
                </Button>
                {!!saved?.length && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={removeSaved}
                    aria-label="حذف الأكواد المحفوظة"
                    title="حذف الأكواد المحفوظة"
                  >
                    <Trash2 />
                  </Button>
                )}
                <label className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={autoApply}
                    onChange={(e) => toggleAutoApply(e.target.checked)}
                    className="size-3.5 accent-primary"
                  />
                  تحديد المحفوظ تلقائياً عند رفع ملف
                </label>
                {savedNotice && (
                  <p
                    className={cn(
                      "w-full text-xs",
                      savedNotice.kind === "error"
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {savedNotice.text}
                  </p>
                )}
              </div>
            </div>
            <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
              {filtered.slice(0, LIST_LIMIT).map((item) => (
                <li
                  key={item.code}
                  onClick={() => setSelected(item.code)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/40",
                    selected === item.code &&
                      "bg-primary/10 shadow-[inset_-3px_0_0_var(--color-primary)]",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={pickedSet.has(item.code)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => {
                      togglePick(item.code);
                      setSelected(item.code);
                    }}
                    aria-label={`اختيار ${item.code} للتصدير`}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="w-16 shrink-0 tabular-nums font-medium">
                    {item.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span dir="ltr" className="block truncate text-start">
                      {nameOf(item)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {companyOf(item.code) || "—"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border">
            {selectedItem ? (
              <ItemDetail
                item={selectedItem}
                name={nameOf(selectedItem)}
                company={companyOf(selectedItem.code)}
                picked={pickedSet.has(selectedItem.code)}
                onTogglePick={() => togglePick(selectedItem.code)}
              />
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">
                اختر صنف لعرض حركاته.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Export of the picked codes */}
      {htm && picked.length > 0 && (
        <>
          <ReportSettings
            value={settings}
            onChange={(p) => setSettings((s) => ({ ...s, ...p }))}
          />

          <div className="rounded-xl border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2">
              <span className="text-sm font-medium">
                الأصناف المختارة ({picked.length})
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  حد إجمالي الكمية لكل شيت
                  <input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    value={capAll}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      setCapAll(v);
                      setCaps((c) => ({
                        ...c,
                        ...Object.fromEntries(picked.map((code) => [code, v])),
                      }));
                    }}
                    placeholder="بدون حد"
                    className="h-8 w-24 rounded-md border border-border bg-background px-2 text-center text-sm tabular-nums text-foreground"
                  />
                </label>
                <Button size="sm" variant="ghost" onClick={clearPicked}>
                  <X />
                  إلغاء الاختيار
                </Button>
                <Button size="sm" variant="outline" onClick={copyTotals}>
                  {copied === "totals" ? <Check /> : <ClipboardCopy />}
                  {copied === "totals" ? "تم النسخ" : "نسخ الإجماليات"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyAllRows}
                  disabled={!settings.style || downloadable === 0}
                  title={
                    !settings.style
                      ? "اختر شكل الشيت أولاً"
                      : "نسخ صفوف كل الأصناف (بدون العناوين) للصق في Google Sheets"
                  }
                >
                  {copied === "rows" ? <Check /> : <ClipboardCopy />}
                  {copied === "rows" ? "تم النسخ" : "نسخ الكل للشيت"}
                </Button>
                <Button
                  size="sm"
                  onClick={downloadAll}
                  disabled={!settings.style || downloadable === 0 || downloading}
                  title={!settings.style ? "اختر شكل الشيت أولاً" : undefined}
                >
                  {downloading ? <Loader2 className="animate-spin" /> : <Download />}
                  {downloading
                    ? "جاري التحميل..."
                    : `تحميل الكل (${downloadable} ملف)`}
                </Button>
              </div>
            </div>
            {downloadDone && (
              <DownloadDoneBanner
                done={downloadDone}
                onClose={() => setDownloadDone(null)}
              />
            )}
            {missingBatch && (
              <p className="border-b border-border px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
                الشيت فيه عمود Batch — اكتب الباتش للأصناف الفاضية.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {["م", "الكود", "الصنف", "الباتش", "حد إجمالي الكمية", "صفوف في الشيت", "الكمية المباعة", ""].map(
                      (h, i) => (
                        <th
                          key={i}
                          className="whitespace-nowrap border-b border-border px-3 py-2 text-center text-xs font-semibold text-muted-foreground"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {exports.map((e, idx) => (
                    <tr
                      key={e.item.code}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums font-medium">
                        {e.item.code}
                      </td>
                      <td className="px-3 py-2">
                        <span dir="ltr">{nameOf(e.item)}</span>
                        {companyOf(e.item.code) && (
                          <span className="ms-2 text-xs text-muted-foreground">
                            {companyOf(e.item.code)}
                          </span>
                        )}
                        {e.sel.unmatched.size > 0 && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            غير موجود في ملف الفروع (لن يظهر في الشيت):{" "}
                            {[...e.sel.unmatched]
                              .map(([name, n]) => `${name} (${n})`)
                              .join("، ")}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          dir="ltr"
                          value={batches[e.item.code] ?? ""}
                          onChange={(ev) =>
                            setBatches((b) => ({
                              ...b,
                              [e.item.code]: ev.target.value,
                            }))
                          }
                          placeholder="Batch"
                          className={cn(
                            "h-8 w-32 rounded-md border border-border bg-background px-2 text-center tabular-nums",
                            !!settings.style &&
                              !e.batch &&
                              "border-amber-500",
                          )}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="number"
                          min={0}
                          inputMode="decimal"
                          value={caps[e.item.code] ?? ""}
                          onChange={(ev) =>
                            setCaps((c) => ({
                              ...c,
                              [e.item.code]: ev.target.value,
                            }))
                          }
                          placeholder="بدون حد"
                          aria-label={`حد الكمية لـ ${e.item.code}`}
                          className="h-8 w-24 rounded-md border border-border bg-background px-2 text-center tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {e.sel.rows.length}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        <span className="font-semibold">{fmt(e.qty, 2)}</span>
                        {e.qty !== e.fullQty && (
                          <span className="block text-xs text-muted-foreground">
                            من {fmt(e.fullQty, 2)}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!settings.style || !e.sel.rows.length}
                          onClick={() => downloadOne(e)}
                        >
                          <Download />
                          Excel
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => togglePick(e.item.code)}
                          aria-label={`إزالة ${e.item.code}`}
                        >
                          <X />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/50 font-bold">
                  <tr>
                    <td colSpan={6} className="px-3 py-2 text-start">
                      الإجمالي
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {fmt(grandQty, 2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ItemDetail({
  item,
  name,
  company,
  picked,
  onTogglePick,
}: {
  item: HtmItem;
  name: string;
  company: string;
  picked: boolean;
  onTogglePick: () => void;
}) {
  const qty = itemQty(item);
  const unmatched = item.lines.filter(
    (l) => !matchBranch(l.doc.party, l.doc.partyName),
  ).length;

  return (
    <div>
      <div className="space-y-1 border-b border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold tabular-nums">{item.code}</span>
            <span dir="ltr" className="font-semibold">
              {name}
            </span>
          </p>
          <Button
            size="sm"
            variant={picked ? "outline" : "default"}
            onClick={onTogglePick}
          >
            {picked ? <Minus /> : <Plus />}
            {picked ? "إزالة من التصدير" : "إضافة للتصدير"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {company || "بدون شركة"} · {item.lines.length} حركة · الكمية {fmt(qty, 2)}
          {unmatched > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {" "}
              · {unmatched} غير موجود في ملف الفروع
            </span>
          )}
        </p>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {["م", "التاريخ", "الوقت", "رقم المستند", "جهة التعامل", "الكمية"].map(
                (h) => (
                  <th
                    key={h}
                    className={cn(
                      "whitespace-nowrap border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground",
                      h === "جهة التعامل" ? "text-start" : "text-center",
                    )}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {item.lines.map((l, idx) => {
              const matched = matchBranch(l.doc.party, l.doc.partyName);
              return (
                <tr
                  key={`${l.doc.docNo}-${idx}`}
                  className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                >
                  <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                    {idx + 1}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums">
                    {formatDate(l.doc.docDate)}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{l.doc.time}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{l.doc.docNo}</td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-start",
                      !matched && "text-amber-600 dark:text-amber-400",
                    )}
                    title={matched ? undefined : "غير موجود في ملف الفروع"}
                  >
                    {l.doc.partyArea && (
                      <span className="text-muted-foreground">
                        <bdi>{l.doc.partyArea}</bdi> -{" "}
                      </span>
                    )}
                    <bdi>{l.doc.partyName}</bdi>
                  </td>
                  <td className="px-3 py-2 text-center font-semibold tabular-nums">
                    {fmt(l.qty, 2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
