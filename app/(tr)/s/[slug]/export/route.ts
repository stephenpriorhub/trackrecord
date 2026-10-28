import { buildExport } from "@/lib/tr/export";
import { exportTrades, parseFilters } from "@/lib/tr/queries";
import { serviceBySlug } from "@/lib/tr/services";
import { todayNY } from "@/lib/tr/stats";
import { currentViewer } from "@/lib/tr/viewer";

export const dynamic = "force-dynamic";

/**
 * The service page's trade list as a download: ?format=xlsx (Summary + Trades)
 * or ?format=csv (Trades), with the page's own filter parameters. Signed-in
 * viewers only — a route handler isn't covered by the layout's sign-in check.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!(await currentViewer())) return new Response("Sign in to OxfordHub to download.", { status: 401 });
  const def = serviceBySlug((await params).slug);
  if (!def?.sheetId) return new Response("Not found", { status: 404 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const format = sp.format === "csv" ? "csv" : "xlsx";
  const filters = parseFilters(sp);
  const rows = await exportTrades(def.code, filters);
  const today = todayNY();
  const { body, type } = buildExport(def, rows, filters, format, today);
  const name = `${def.slug}-trades${filters.q ? `-${filters.q.replace(/[^A-Za-z0-9]/g, "")}` : ""}-${today}.${format}`;
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
