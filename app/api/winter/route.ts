import { NextResponse } from "next/server";

import {
  loadWinterData,
  searchWinter,
  searchWinterFamilies,
  topWinter,
} from "@/lib/winter/data";

// GET /api/winter?q=<code or item name>[&family=1]
// GET /api/winter?top=1[&family=1]
// Searches last winter's Oct–Dec sales (bundled JSON) by code or name, or
// (top=1) returns the 50 best-selling winter-related items. With family=1,
// every تشغيلات code of a product is merged into one row.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q") ?? "";
  const family = params.get("family") === "1";
  const data = await loadWinterData();
  const results =
    params.get("top") === "1"
      ? topWinter(data.items, family)
      : family
        ? searchWinterFamilies(data.items, q)
        : searchWinter(data.items, q);
  return NextResponse.json({ year: data.year, results });
}

export const runtime = "nodejs";
