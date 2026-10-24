import { parseBrokerSheet } from "./parse-broker";
import { parsePostMarket } from "./parse-pmk";
import { parseWarRoom } from "./parse-war";
import type { ParseResult } from "./types";
import type { Workbook } from "./workbook";

export type ServiceParseResult = ParseResult & {
  crossLabelled?: { row: number; symbol: string; label: string }[];
  pending?: { row: number; tab: string; symbol: string }[];
};

/** The parser for a service's sheet layout. */
export function parseService(code: string, wb: Workbook): ServiceParseResult {
  switch (code) {
    case "WAR":
      return parseWarRoom(wb);
    case "PMK":
      return parsePostMarket(wb);
    case "DPL":
    case "PSU":
    case "NBS":
      return parseBrokerSheet(code, wb);
    default:
      throw new Error(`No sheet parser for ${code}`);
  }
}
