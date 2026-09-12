export type Stance = "buy" | "sell" | "avoid";

/** What kind of fact this is. Quotes bind. Everything else is a screen. */
export type ClaimStatus = "quote" | "official_print" | "research_calendar" | "partner_share";

export type DeskSource = {
  id: string;
  name: string;
  publisher: string;
  /** Publication or legal as-of date (ISO). */
  asOf: string;
  url: string;
  /** What years the measurement covers, if different from asOf. */
  coverage: string;
};

export type DeskBrief = {
  id: string;
  stance: Stance;
  product: string;
  hsCode: string;
  countries: string[];
  months: number[];
  monthLabel: string;
  headline: string;
  why: string;
  watch: string;
  sources: DeskSource[];
  /** Named quantity or legal rule. If we cannot fill this, the brief must not ship. */
  measured: string;
  status: ClaimStatus;
  origin?: string;
  destination?: string;
};

export const ALL_YEAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function isCompleteBrief(brief: DeskBrief): boolean {
  return (
    brief.sources.length > 0 &&
    brief.sources.every((source) => Boolean(source.name && source.asOf && source.url)) &&
    Boolean(brief.measured) &&
    Boolean(brief.status) &&
    Boolean(brief.headline) &&
    Boolean(brief.why)
  );
}
