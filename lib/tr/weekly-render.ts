/**
 * The weekly report's content types and email HTML. Pure (no database), so the
 * editor can render the same preview in the browser that the send will use.
 */

export interface ReportTable {
  title: string;
  columns: string[];
  /** [label, ...one cell per column] */
  rows: string[][];
  /** This week's best trade, or null for "none closed this week". */
  best: { position: string; ret: string; days: string } | null;
  /** False for a portfolio summary, which has no "best trade this week" row. */
  showBest?: boolean;
  link: string;
  linkLabel: string;
}

export interface ReportSection {
  code: string;
  name: string;
  color: string;
  include: boolean;
  /** Closed trades this week, at generation — drives the intro's wording. */
  closedThisWeek: number;
  /** Editor's note, shown under the section's tables. */
  note: string;
  tables: ReportTable[];
}

export interface ReportContent {
  subject: string;
  intro: string;
  closing: string;
  sections: ReportSection[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Web addresses in already-escaped text → links. */
const linkify = (html: string) =>
  html.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" style="color:#1155cc">${u}</a>`);

/** Plain text with blank-line paragraphs and single-line breaks → HTML. */
function paras(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px">${linkify(esc(p)).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const FONT = "font-family:Calibri,Arial,Helvetica,sans-serif;";
const CELL = `${FONT}font-size:14px;padding:4px 10px;border:1px solid #d9d9d9;`;

function tableHtml(t: ReportTable, color: string): string {
  const head = `<tr><td colspan="${t.columns.length + 1}" style="${FONT}background:${color};color:#fff;font-size:18px;font-weight:bold;text-align:center;padding:6px 10px;border:1px solid ${color}">${esc(t.title)}</td></tr>`;
  const cols = `<tr><td style="${CELL}border-top:0"></td>${t.columns.map((c) => `<td style="${CELL}text-align:center;font-weight:bold;border-top:0">${esc(c)}</td>`).join("")}</tr>`;
  const body = t.rows
    .map(
      (r, i) =>
        `<tr style="background:${i % 2 ? "#ffffff" : "#f2f2f2"}"><td style="${CELL}text-align:right;font-weight:bold;white-space:nowrap">${esc(r[0])}:</td>${r
          .slice(1)
          .map((v) => `<td style="${CELL}text-align:center">${esc(v)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  const best = t.showBest === false ? "" : `<tr><td colspan="${t.columns.length + 1}" style="${CELL}background:#ddebf7;text-align:center;font-weight:bold">This Week's Best Performing Trade</td></tr>${
    t.best
      ? `<tr><td style="${CELL}text-align:right;font-weight:bold">Position:</td><td colspan="2" style="${CELL}text-align:center">${esc(t.best.position)}</td><td style="${CELL}text-align:center">${esc(t.best.ret)}</td><td style="${CELL}text-align:center">${esc(t.best.days)} days held</td></tr>`
      : `<tr><td colspan="${t.columns.length + 1}" style="${CELL}text-align:center;color:#7f7f7f">No trades closed this week.</td></tr>`
  }`;
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;margin:0 0 6px">${head}${cols}${body}${best}</table>
<p style="${FONT}font-size:14px;margin:0 0 22px"><a href="${esc(t.link)}" style="color:#1155cc">${esc(t.linkLabel)}</a></p>`;
}

export function renderEmail(content: ReportContent, generatedAt: Date): string {
  const asOf = generatedAt.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
  const sections = content.sections
    .filter((s) => s.include)
    .map(
      (s) =>
        `${s.tables.map((t) => tableHtml(t, s.color)).join("")}${s.note.trim() ? `<div style="${FONT}font-size:14px;margin:-12px 0 24px">${paras(s.note)}</div>` : ""}`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:16px;background:#ffffff;color:#000">
<div style="${FONT}font-size:15px;max-width:720px">${paras(content.intro)}</div>
<div style="height:8px"></div>
${sections}
${content.closing.trim() ? `<div style="${FONT}font-size:15px;max-width:720px">${paras(content.closing)}</div>` : ""}
<p style="${FONT}font-size:12px;color:#7f7f7f;margin-top:20px">Figures from the MTA Track Record as of ${esc(asOf)} ET. Closed trades only; "This Week" includes trades that closed after the bell on the previous Friday.</p>
</body></html>`;
}

/** Recipient lines as pasted from Outlook ("Name <a@b.com>; ...") or one per line. */
export function parseRecipients(text: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  // Semicolons and newlines separate; commas only in a bare list (an Outlook
  // name can itself be "Last, First").
  // A missing separator between two pasted entries ("…com>Jordan Vass <…") is common.
  const parts = text.replace(/>\s*(?=[^\s;,\n])/g, ">;").split(/[;\n]+/).flatMap((p) => (p.includes("<") ? [p] : p.split(",")));
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+\.[^<>\s]+)\s*>$/) ?? part.match(/^()([^<>\s]+@[^<>\s]+\.[^<>\s]+)$/);
    if (!m) {
      bad.push(part);
      continue;
    }
    const email = m[2].toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const name = m[1].trim().replace(/^"|"$/g, "");
    // A name with a comma ("Last, First") must be quoted, or it reads as two addresses.
    ok.push(name ? `${/[,;:"<>@()[\]]/.test(name) ? `"${name.replace(/"/g, "")}"` : name} <${email}>` : email);
  }
  return { ok, bad };
}

