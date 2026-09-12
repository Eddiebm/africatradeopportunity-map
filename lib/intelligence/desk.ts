import { DESK_BRIEFS, DESK_HOMES } from "./registry";
import { MONTH_NAMES, type DeskBrief, type Stance } from "./types";

export type DeskCard = DeskBrief & {
  inMonth: boolean;
};

export type CountryDesk = {
  home: string;
  homes: string[];
  month: number;
  monthName: string;
  stance: Stance | "all";
  lead: string;
  buy: DeskCard[];
  sell: DeskCard[];
  avoid: DeskCard[];
  sourcedCount: number;
  disclaimer: string;
};

export type GhanaDesk = CountryDesk;

function asCard(brief: DeskBrief, month: number): DeskCard {
  return {
    ...brief,
    inMonth: brief.months.includes(month),
  };
}

function leadSentence(home: string, month: number, buy: DeskCard[], sell: DeskCard[], avoid: DeskCard[]): string {
  const monthName = MONTH_NAMES[month - 1];
  if (!buy.length && !sell.length) {
    return `If you live in ${home} in ${monthName}, this desk is complete: legal screens only. There is no sourced perishable buy or sell window for this home — empty harvest is the product, not a missing country file.`;
  }
  const parts: string[] = [];
  if (buy[0]) parts.push(`consider ${buy[0].product.toLowerCase()} from ${buy[0].countries.join(" and ")}`);
  if (sell[0]) parts.push(`consider selling ${sell[0].product.toLowerCase()} to ${sell[0].countries.join(" and ")}`);
  const loss = avoid.find((card) => card.id !== "desk-complete");
  if (loss) parts.push(`treat ${loss.product.toLowerCase()} as a documented no-go unless papers and a dated bid already exist`);
  return `If you live in ${home} in ${monthName}, ${parts.join(". ")}.`;
}

export function buildDesk(opts: {
  home?: string;
  month: number;
  stance?: string;
}): CountryDesk {
  const home = DESK_HOMES.includes(opts.home || "") ? (opts.home as string) : "Ghana";
  const month = opts.month >= 1 && opts.month <= 12 ? opts.month : new Date().getUTCMonth() + 1;
  const stanceRaw = opts.stance || "all";
  const stance: Stance | "all" =
    stanceRaw === "buy" || stanceRaw === "sell" || stanceRaw === "avoid" ? stanceRaw : "all";
  const briefs = DESK_BRIEFS[home] || [];
  const cards = briefs.map((brief) => asCard(brief, month));
  const inSeason = (card: DeskCard, want: Stance) =>
    card.stance === want && (card.months.length === 12 || card.inMonth);
  const buy = cards.filter((card) => inSeason(card, "buy"));
  const sell = cards.filter((card) => inSeason(card, "sell"));
  const avoid = cards.filter((card) => inSeason(card, "avoid"));
  return {
    home,
    homes: DESK_HOMES,
    month,
    monthName: MONTH_NAMES[month - 1],
    stance,
    lead: leadSentence(home, month, buy, sell, avoid),
    buy: stance === "all" || stance === "buy" ? buy : [],
    sell: stance === "all" || stance === "sell" ? sell : [],
    avoid: stance === "all" || stance === "avoid" ? avoid : [],
    sourcedCount: briefs.length,
    disclaimer: `54 African homes ship on this desk. Only claims with a named source, as-of date and measured quantity. Research calendars are screening notes, not offers. A quote is only binding when a verified counterparty submits it.`,
  };
}

export function buildGhanaDesk(opts: { month: number; stance?: string }): CountryDesk {
  return buildDesk({ ...opts, home: "Ghana" });
}
