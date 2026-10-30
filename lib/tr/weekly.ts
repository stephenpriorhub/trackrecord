/**
 * The Friday "MTA - Weekly Performance Report" email.
 *
 * A draft is GENERATED (Fridays at noon ET, or by an admin), then reviewed and
 * edited, then SENT by an admin pressing Send. Nothing here sends on its own:
 * generation only ever writes a draft row.
 *
 * The numbers are the app's own (summarise / statsByPeriod — the same figures
 * as the service pages), frozen into the draft as display strings so an editor
 * can correct any cell before it goes out. "Refresh numbers" rebuilds the
 * tables and keeps the editor's notes.
 */
import { prisma } from "../prisma";
import { loadSummaryTrades, summarise } from "./queries";
import { longTermBooks, summariseBooks } from "./longterm";
import { SHEET_SERVICES, serviceByCode, type ServiceDef } from "./services";
import { periodBounds, todayNY, type PeriodKey, type PeriodStats } from "./stats";
import { parseRecipients, renderEmail, type ReportContent, type ReportSection, type ReportTable } from "./weekly-render";

export * from "./weekly-render";

const APP = (process.env.TR_PUBLIC_URL ?? "https://trackrecord.oxfordhub.app").replace(/\/+$/, "");

/** Header colours, after the sheets' own Summary Stats tabs. */
const COLOR: Record<string, string> = {
  WAR: "#2e75b6",
  DPL: "#548235",
  PSU: "#c55a11",
  NBS: "#7f6000",
  PMK: "#7c4dff",
  TPU: "#1f3864",
  XAI: "#0b5394",
};

/** Long-term services summarised as portfolios (no trade periods) in the report. */
const PORTFOLIO_SUMMARIES = ["XAI"];

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "week", label: "This Week" },
  { key: "month", label: "Month to Date" },
  { key: "year", label: "Year to Date" },
  { key: "inception", label: "Since Inception" },
];

const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(2)}%`);
const pct1 = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(1)}%`);
const days = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : x.toFixed(1));
const count = (n: number) => n.toLocaleString("en-US");

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Friday of the week `today` falls in (Monday-Sunday weeks). */
export function weekEndingFor(today: string = todayNY()): string {
  return addDays(periodBounds("week", today).start, 4);
}

/** "10.16.26", as the report's subject line has always written it. */
export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${m}.${d}.${String(y).slice(2)}`;
}

function table(
  def: ServiceDef,
  title: string,
  stats: Record<PeriodKey, PeriodStats>,
  weighted: boolean,
  link: string,
  linkLabel = `View the full ${def.name.replace(/^The /, "")} track record →`,
): ReportTable {
  const row = (label: string, f: (s: PeriodStats) => string) => [label, ...PERIODS.map((p) => f(stats[p.key]))];
  const rows = [
    row("# of Closed Trades", (s) => count(s.closed)),
    row("# of Winners", (s) => count(s.winners)),
    ...(weighted
      ? [
          row("Average Return (Unweighted)", (s) => pct(s.avgReturn)),
          row("Weighted Average Return", (s) => pct(s.weightedAvgReturn)),
        ]
      : [row("Average Return", (s) => pct(s.avgReturn))]),
    row("Average Days Held", (s) => days(s.avgDaysHeld)),
    row("Win Rate", (s) => pct1(s.winRate)),
  ];
  const b = stats.week.best;
  return {
    title,
    columns: PERIODS.map((p) => p.label),
    rows,
    best: b ? { position: b.name || b.symbol, ret: pct(b.returnPct), days: b.days === null ? "—" : String(b.days) } : null,
    link,
    linkLabel,
  };
}

/** Where a table's link points: the public page when it's switched on, else the signed-in page. */
async function linkFor(def: ServiceDef, filter?: Record<string, string>): Promise<string> {
  const row = await prisma.trService.findUnique({ where: { code: def.code }, select: { publicEnabled: true, publicToken: true } });
  if (row?.publicEnabled && row.publicToken) return `${APP}/t/${row.publicToken}`;
  const qs = filter ? `?${new URLSearchParams(filter)}#trades` : "";
  return `${APP}/s/${def.slug}${qs}`;
}

export async function buildSections(today: string = todayNY()): Promise<ReportSection[]> {
  const byCode = await loadSummaryTrades(SHEET_SERVICES.map((s) => s.code));
  const out: ReportSection[] = [];
  for (const def of [...SHEET_SERVICES].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const summary = summarise(def, byCode.get(def.code) ?? [], today);
    const weighted = !!def.weighted;
    const tables: ReportTable[] = [];
    if (def.byGuru) {
      tables.push(table(def, `${def.name} (${def.gurus.map((g) => g.split(" ")[0]).join(" & ")} Combined)`, summary.headline, weighted, await linkFor(def)));
      for (const g of summary.groups.filter((x) => x.kind === "guru")) {
        tables.push(table(def, g.label, g.stats, weighted, await linkFor(def, { guru: g.key }), `View ${g.label.split(" ")[0]}'s trades →`));
      }
    } else {
      tables.push(table(def, def.name, summary.headline, weighted, await linkFor(def)));
      // PMK's Dark Ticker / Stock Flips. (Trend Advisory's older brands are
      // archives, not news — the headline already is Trend Advisory.)
      if (def.bookToggle) {
        for (const sp of def.subPortfolios) {
          const g = summary.groups.find((x) => x.kind === "portfolio" && x.key === sp.key);
          if (g) tables.push(table(def, sp.label, g.stats, weighted, await linkFor(def, { portfolio: sp.key }), `View the ${sp.label} trades →`));
        }
      }
    }
    out.push({
      code: def.code,
      name: def.name,
      color: COLOR[def.code] ?? "#1f3864",
      include: true,
      closedThisWeek: summary.headline.week.closed,
      note: "",
      tables,
    });
  }
  for (const code of PORTFOLIO_SUMMARIES) {
    const def = serviceByCode(code);
    if (def) out.push(await portfolioSection(def));
  }
  return out;
}

const signed = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(2)}%`);

/** McCall-style service: one row per portfolio, returns since each one started. No S&P comparison (Stephen, 2026-10-30). */
async function portfolioSection(def: ServiceDef): Promise<ReportSection> {
  const books = summariseBooks(await longTermBooks(def, false)).filter((b) => b.open + b.closed > 0);
  const since = (d: Date | null) =>
    d ? ` (since ${d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit", timeZone: "UTC" })})` : "";
  return {
    code: def.code,
    name: def.name,
    color: COLOR[def.code] ?? "#1f3864",
    include: true,
    // Not trade-by-trade: the intro shouldn't list it as quiet or active.
    closedThisWeek: -1,
    note: "",
    tables: [
      {
        title: def.name,
        columns: ["Positions", "Total Return", "Realized", "Unrealized"],
        rows: books.map((b) => [
          `${b.label}${since(b.since)}`,
          `${b.open} open · ${b.closed} closed`,
          signed(b.totalReturn),
          signed(b.realized),
          signed(b.unrealized),
        ]),
        best: null,
        showBest: false,
        link: await linkFor(def),
        linkLabel: `View the full ${def.name.replace(/^The /, "")} portfolios →`,
      },
    ],
  };
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function defaultIntro(sections: ReportSection[]): string {
  const trading = sections.filter((s) => s.closedThisWeek >= 0);
  const active = trading.filter((s) => s.closedThisWeek > 0).map((s) => s.name);
  const quiet = trading.filter((s) => s.closedThisWeek === 0).map((s) => s.name);
  const lines = ["Good afternoon,", ""];
  lines.push(active.length ? `Below are this week's performance stats for ${list(active)}.` : "No trades closed this week.");
  if (quiet.length && active.length) lines.push("", `No changes to ${list(quiet)}.`);
  lines.push(
    "",
    "You can view the full track record in our new MTA Track Record app inside the OxfordHub. If you don't have an OxfordHub account yet, you can register here: https://oxfordhub.app/register/mta-team",
  );
  return lines.join("\n");
}

/** Generate this week's draft. Never overwrites one that has been edited or sent. */
export async function generateWeeklyDraft(today: string = todayNY(), by = "schedule") {
  const weekEnding = weekEndingFor(today);
  const existing = await prisma.trWeeklyReport.findUnique({ where: { weekEnding: new Date(`${weekEnding}T00:00:00Z`) } });
  if (existing) {
    // The noon run brings an untouched draft (made early by hand) up to date;
    // a draft anyone has edited, or one already sent, is never changed.
    if (by === "schedule" && existing.status === "DRAFT" && !existing.editedAt) {
      const content = await refreshedContent(existing.content as unknown as ReportContent, today);
      const fresh = { ...content, intro: defaultIntro(content.sections) };
      const report = await prisma.trWeeklyReport.update({
        where: { id: existing.id },
        data: { content: fresh as object, generatedAt: new Date(), generatedBy: by },
      });
      return { created: false, report };
    }
    return { created: false, report: existing };
  }
  const sections = await buildSections(today);
  const content: ReportContent = {
    subject: `MTA - Weekly Performance Report - ${shortDate(weekEnding)}`,
    intro: defaultIntro(sections),
    closing: "",
    sections,
  };
  try {
    const report = await prisma.trWeeklyReport.create({
      data: { weekEnding: new Date(`${weekEnding}T00:00:00Z`), content: content as object, generatedBy: by },
    });
    return { created: true, report };
  } catch {
    // Two generators raced (schedule + a button press): the other one won.
    const report = await prisma.trWeeklyReport.findUniqueOrThrow({ where: { weekEnding: new Date(`${weekEnding}T00:00:00Z`) } });
    return { created: false, report };
  }
}

/** A whole new draft body (sections + default opening), keeping the subject. */
export async function rebuiltContent(content: ReportContent, today: string = todayNY()): Promise<ReportContent> {
  const sections = await buildSections(today);
  return { subject: content.subject, intro: defaultIntro(sections), closing: "", sections };
}

/** Rebuilt numbers, keeping each section's note and include switch. */
export async function refreshedContent(content: ReportContent, today: string = todayNY()): Promise<ReportContent> {
  const fresh = await buildSections(today);
  return {
    ...content,
    sections: fresh.map((s) => {
      const old = content.sections.find((o) => o.code === s.code);
      return old ? { ...s, include: old.include, note: old.note } : s;
    }),
  };
}

// ---- sending --------------------------------------------------------------------

/** Resend's cap on To + Cc in one message. */
export const MAX_RECIPIENTS = 50;
const FROM = () => process.env.TR_EMAIL_FROM || "MTA Track Record <no-reply@oxfordhub.app>";

async function deliver(args: { to: string[]; cc: string[]; replyTo: string; subject: string; html: string }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Email isn't set up: RESEND_API_KEY is missing on the Track Record service.");
  const { Resend } = await import("resend");
  const { error } = await new Resend(key).emails.send({
    from: FROM(),
    to: args.to,
    cc: args.cc.length ? args.cc : undefined,
    replyTo: args.replyTo,
    subject: args.subject,
    html: args.html,
  });
  if (error) throw new Error(error.message ?? String(error));
}

/**
 * The starting list (Stephen, 2026-10-30): the old report's To and Cc lines,
 * plus Matt McCall and Patrick Bove. Written only when no list exists yet —
 * never over one an admin has saved.
 */
const STARTING_TO =
  "Jonathan Mead <JMead@oxfordclub.com>; John Oravec <joravec@oxfordclub.com>; Ryan Fitzwater <rfitzwater@MonumentTradersAlliance.com>; Bryan Bottarelli <bbottarelli@monumenttradersalliance.com>; Karim Rahemtulla <krahemtulla@oxfordclub.com>; Todd Skousen <TSkousen@OxfordClub.com>; Nathan Bear <nbear@cw.monumenttradersalliance.com>; Kristin Haugk <khaugk@oxfordclub.com>; Chris Jacob <cjjacob@Oxfordclub.com>; Drew Dyer <ddyer@monumenttradersalliance.com>; Amanda Heckman <aheckman@monumenttradersalliance.com>; Chris Johnson <cjohnson@monumenttradersalliance.com>; Matt McCall <mmccall@monumenttradersalliance.com>";
const STARTING_CC =
  "Jordan Vass <jvass@monumenttradersalliance.com>; Monica Eppley <meppley@oxfordclub.com>; Kimberly Vogel <kvogel@monumenttradersalliance.com>; Isabel Corral <ICorral@monumenttradersalliance.com>; Oxford Long Form Copywriters <OxfordLongFormCopywriters@oxfordclub.com>; Jarrod Feintuch <jfeintuch@cw.oxfordclub.com>; Connor McKim <cmckim@theagora.com>; John Goff <John.Goff@emeraldcontactcentre.ie>; Nick Pritzakis <npritzakis@cw.monumenttradersalliance.com>; Michael Schussler <mschussler@monumenttradersalliance.com>; Greg Grillot <grillot@gmail.com>; Patrick Bove <pbove@theagora.com>";

export async function reportSettings() {
  const row = await prisma.trReportSettings.findUnique({ where: { id: "weekly" } });
  if (row) return row;
  return prisma.trReportSettings
    .create({ data: { id: "weekly", to: parseRecipients(STARTING_TO).ok, cc: parseRecipients(STARTING_CC).ok, updatedBy: "starting list" } })
    .catch(() => prisma.trReportSettings.findUniqueOrThrow({ where: { id: "weekly" } }));
}

/** A copy to the admin alone. Changes nothing on the report. */
export async function sendTest(id: string, email: string) {
  const r = await prisma.trWeeklyReport.findUniqueOrThrow({ where: { id } });
  const content = r.content as unknown as ReportContent;
  await deliver({ to: [email], cc: [], replyTo: email, subject: `[TEST] ${content.subject}`, html: renderEmail(content, r.generatedAt) });
}

/**
 * The real send, to the saved list. Claims the draft first (DRAFT → SENDING in
 * one statement), so a double click or two admins at once can't send twice.
 */
export async function sendReport(id: string, sender: string) {
  const s = await reportSettings();
  if (!s.to.length) throw new Error("Add at least one recipient first.");
  if (s.to.length + s.cc.length > MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS} recipients (To + Cc) per send.`);
  const claimed = await prisma.trWeeklyReport.updateMany({ where: { id, status: "DRAFT" }, data: { status: "SENDING", lastError: null } });
  if (claimed.count === 0) throw new Error("This report has already been sent (or is sending right now).");
  const r = await prisma.trWeeklyReport.findUniqueOrThrow({ where: { id } });
  const content = r.content as unknown as ReportContent;
  try {
    await deliver({ to: s.to, cc: s.cc, replyTo: sender, subject: content.subject, html: renderEmail(content, r.generatedAt) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.trWeeklyReport.update({ where: { id }, data: { status: "DRAFT", lastError: msg } });
    throw new Error(`Not sent: ${msg}`);
  }
  await prisma.trWeeklyReport.update({
    where: { id },
    data: { status: "SENT", sentAt: new Date(), sentBy: sender, sentTo: { to: s.to, cc: s.cc } },
  });
}
