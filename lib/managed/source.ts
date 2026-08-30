/**
 * Where a portfolio's positions come from, and how to open one at its source.
 *
 * THE SHAPE THIS IS BUILT FOR
 *   The sync is ONE WAY, always. Airtable and the published sheets are read;
 *   nothing is ever written back. That is deliberate beyond safety — the goal is
 *   for this app to become the record, at which point a portfolio simply stops
 *   having a source and nothing else changes. So "no source" is a first-class
 *   state, not a broken one, and every function here returns null rather than
 *   throwing when a portfolio is hand-maintained.
 *
 *   URLs are DERIVED from stored ids rather than stored themselves. If a base is
 *   moved or a sheet replaced, one function changes instead of thousands of rows.
 */
import { TABLES } from "../airtable";

export type SourceSystem = "MANUAL" | "AIRTABLE" | "GOOGLE_SHEET";

export interface PortfolioSource {
  system: SourceSystem;
  /** Human label for the settings panel — "Airtable", "Google Sheet". */
  label: string;
  /** Where to open the source as a whole. Null for a hand-maintained book. */
  url: string | null;
  syncedAt: Date | null;
  note: string | null;
}

interface PortfolioLike {
  airtableTradeGroupId?: string | null;
  sourceSheetId?: string | null;
  syncedAt?: Date | null;
  syncNote?: string | null;
}

interface PositionLike {
  airtableId?: string | null;
  externalKey?: string | null;
}

function base(): string | null {
  return process.env.AIRTABLE_PORTFOLIO_BASE ?? null;
}

/** Airtable's deep link to one record. */
export function airtableRecordUrl(
  table: string,
  recordId: string,
): string | null {
  const b = base();
  return b ? `https://airtable.com/${b}/${table}/${recordId}` : null;
}

export function googleSheetUrl(sheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

/** What a portfolio is fed by, if anything. */
export function portfolioSource(p: PortfolioLike): PortfolioSource {
  if (p.sourceSheetId) {
    return {
      system: "GOOGLE_SHEET",
      label: "Google Sheet",
      url: googleSheetUrl(p.sourceSheetId),
      syncedAt: p.syncedAt ?? null,
      note: p.syncNote ?? null,
    };
  }
  if (p.airtableTradeGroupId) {
    return {
      system: "AIRTABLE",
      label: "Airtable",
      url: airtableRecordUrl(TABLES.portfolios, p.airtableTradeGroupId),
      syncedAt: p.syncedAt ?? null,
      note: p.syncNote ?? null,
    };
  }
  return {
    system: "MANUAL",
    label: "Maintained here",
    url: null,
    syncedAt: p.syncedAt ?? null,
    note: p.syncNote ?? null,
  };
}

/**
 * Where to open ONE position at its source.
 *
 * Airtable has a record per position, so the link goes straight to it. A
 * spreadsheet has only rows, and a row number is not stable across edits — so a
 * sheet-backed position links to the sheet itself rather than inventing an
 * anchor that would quietly point at the wrong trade after any insertion.
 */
export function positionSourceUrl(
  position: PositionLike,
  portfolio: PortfolioLike,
): { url: string; label: string } | null {
  if (position.airtableId) {
    const url = airtableRecordUrl(TABLES.positions, position.airtableId);
    return url ? { url, label: "Open in Airtable" } : null;
  }
  if (position.externalKey?.startsWith("sheet:") && portfolio.sourceSheetId) {
    return {
      url: googleSheetUrl(portfolio.sourceSheetId),
      label: "Open source sheet",
    };
  }
  return null;
}
