export type LiveListing = {
  id: number;
  role: string;
  product: string;
  origin: string;
  destination: string;
  volume: string;
  status: string;
  createdAt: string;
};

export type ResearchWindow = {
  id: string;
  stance: "buy" | "sell";
  product: string;
  hsCode: string;
  headline: string;
  why: string;
  measured: string;
  monthLabel: string;
  origin?: string;
  destination?: string;
  sources: Array<{ name: string; url: string; asOf: string }>;
};

export type AvoidNote = {
  id: string;
  headline: string;
  why: string;
};

export type ReferenceLane = {
  product: string;
  hsCode: string;
  origin: string;
  destination: string;
  unit: string;
  signal: string;
};

export type PublicBoard = {
  id: string;
  name: string;
  publisher: string;
  url: string;
  whatYouFind: string;
  coverage: string;
};

export type OpportunityPack = {
  home: string;
  month: number;
  monthName: string;
  disclaimer: string;
  liveListings: LiveListing[];
  researchWindows: ResearchWindow[];
  avoidNotes: AvoidNote[];
  referenceLanes: ReferenceLane[];
  publicBoards: PublicBoard[];
};

export type ParsedOrder = {
  role: "wanted" | "for_sale" | "freight_available";
  product: string;
  hsCode: string;
  origin: string;
  destination: string;
  volume: string;
  targetPrice: string;
  contact: string;
  confidence: number;
  notes: string[];
};
