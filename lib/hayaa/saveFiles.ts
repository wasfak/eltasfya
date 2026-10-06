/** Saving finished Excel reports in the browser (shared by the hayaa pages). */

export type Report = { name: string; buffer: ArrayBuffer };

export function saveViaBrowser(name: string, buffer: ArrayBuffer) {
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

/**
 * Asks for a folder once and writes every report into it. Browsers without
 * the folder picker (Firefox/Safari) fall back to one download per file.
 * Returns null if the user cancelled the folder picker.
 */
export async function saveAllReports(
  builders: Array<() => Promise<Report | null>>,
): Promise<{ count: number; folder: string | null } | null> {
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
      return null;
    }
  }

  let count = 0;
  for (const build of builders) {
    const report = await build();
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
  return { count, folder: dir?.name ?? null };
}

/** Short two-note chime so a finished download is noticed even off-screen. */
export function playChime() {
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
export function toTsv(rows: Array<Array<string | number>>): string {
  return rows
    .map((r) => r.map((v) => String(v).replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\n");
}
