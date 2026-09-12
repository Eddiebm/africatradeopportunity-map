import { africaCountries } from "../africa-countries";
import { buildDesk } from "../intelligence/desk";
import { MONTH_NAMES } from "../intelligence/types";
import { REFERENCE_LANES } from "../prices/lanes";
import { boardsFor } from "./boards";
import type { LiveListing, OpportunityPack, ResearchWindow } from "./types";

const HOME_SET = new Set<string>(africaCountries.map(([name]) => name));

export function resolveHome(value: string | null): string {
  if (value && HOME_SET.has(value)) return value;
  return "Ghana";
}

export function assembleOpportunities(opts: {
  home: string;
  month: number;
  listings: LiveListing[];
}): OpportunityPack {
  const home = resolveHome(opts.home);
  const month = opts.month >= 1 && opts.month <= 12 ? opts.month : new Date().getUTCMonth() + 1;
  const desk = buildDesk({ home, month, stance: "all" });
  const listings = opts.listings.filter(
    (row) =>
      row.origin === home ||
      row.destination === home ||
      (row.role === "protection_request" && (row.origin === home || row.destination === home)),
  );
  return {
    home,
    month,
    monthName: MONTH_NAMES[month - 1],
    disclaimer:
      "WhatsApp groups, Facebook, and private classifieds cannot be scraped. Live orders appear here only after someone posts or pastes them. Research windows are published calendars, not bids. Public boards are official notice sites — open them yourself.",
    liveListings: listings.filter((row) => row.role !== "protection_request"),
    researchWindows: [...desk.buy, ...desk.sell].flatMap((card): ResearchWindow[] => {
      if (card.stance !== "buy" && card.stance !== "sell") return [];
      return [{
        id: card.id,
        stance: card.stance,
        product: card.product,
        hsCode: card.hsCode,
        headline: card.headline,
        why: card.why,
        measured: card.measured,
        monthLabel: card.monthLabel,
        origin: card.origin,
        destination: card.destination,
        sources: card.sources.map((source) => ({ name: source.name, url: source.url, asOf: source.asOf })),
      }];
    }),
    avoidNotes: desk.avoid.map((card) => ({ id: card.id, headline: card.headline, why: card.why })),
    referenceLanes: REFERENCE_LANES.filter((lane) => lane.origin === home || lane.destination === home).map((lane) => ({
      product: lane.product,
      hsCode: lane.hsCode,
      origin: lane.origin,
      destination: lane.destination,
      unit: lane.unit,
      signal: lane.signal,
    })),
    publicBoards: boardsFor(home),
  };
}
