import type { PublicBoard } from "./types";

const ECOWAS12 = new Set([
  "Benin",
  "Cabo Verde",
  "Côte d’Ivoire",
  "Gambia",
  "Ghana",
  "Guinea",
  "Guinea-Bissau",
  "Liberia",
  "Nigeria",
  "Senegal",
  "Sierra Leone",
  "Togo",
]);

const AES = new Set(["Burkina Faso", "Mali", "Niger"]);
const EAC = new Set(["Burundi", "DR Congo", "Kenya", "Rwanda", "Somalia", "South Sudan", "Tanzania", "Uganda"]);
const SACU = new Set(["Botswana", "Eswatini", "Lesotho", "Namibia", "South Africa"]);
const MAGHREB = new Set(["Algeria", "Egypt", "Libya", "Mauritania", "Morocco", "Tunisia"]);

const CONTINENT: PublicBoard[] = [
  {
    id: "comtrade",
    name: "UN Comtrade",
    publisher: "United Nations",
    url: "https://comtradeplus.un.org/",
    whatYouFind: "Official recorded trade flows by HS code — not WhatsApp bids.",
    coverage: "All 54 reporting countries, with gaps",
  },
  {
    id: "macmap",
    name: "ITC Market Access Map",
    publisher: "International Trade Centre",
    url: "https://www.macmap.org/",
    whatYouFind: "Tariffs, rules of origin and trade-remedy notices.",
    coverage: "Continental",
  },
  {
    id: "afcfta",
    name: "AfCFTA Secretariat",
    publisher: "African Union",
    url: "https://au-afcfta.org/",
    whatYouFind: "Protocols, origin rules and guided-trade notices.",
    coverage: "Continental",
  },
  {
    id: "ungm",
    name: "UN Global Marketplace",
    publisher: "United Nations",
    url: "https://www.ungm.org/Public/Notice",
    whatYouFind: "Public tenders that sometimes buy African food and materials.",
    coverage: "Continental",
  },
];

const BY_HOME: Record<string, PublicBoard[]> = {
  Ghana: [
    {
      id: "gepa",
      name: "Ghana Export Promotion Authority",
      publisher: "GEPA",
      url: "https://www.gepaghana.org/",
      whatYouFind: "Exporter programmes and product notices — not informal truck bids.",
      coverage: "Ghana",
    },
    {
      id: "gcx",
      name: "Ghana Commodity Exchange",
      publisher: "GCX",
      url: "https://www.gcx.com.gh/",
      whatYouFind: "Warehouse receipts and listed commodity contracts.",
      coverage: "Ghana",
    },
    {
      id: "ppa-gh",
      name: "Public Procurement Authority",
      publisher: "PPA Ghana",
      url: "https://ppa.gov.gh/",
      whatYouFind: "Government tenders that can offtake food and construction inputs.",
      coverage: "Ghana",
    },
  ],
  Nigeria: [
    {
      id: "nepc",
      name: "Nigerian Export Promotion Council",
      publisher: "NEPC",
      url: "https://nepc.gov.ng/",
      whatYouFind: "Exporter registration and product-desk notices.",
      coverage: "Nigeria",
    },
  ],
  Kenya: [
    {
      id: "brand-kenya",
      name: "Kenya Export Promotion and Branding Agency",
      publisher: "KEPROBA",
      url: "https://www.makeitkenya.go.ke/",
      whatYouFind: "Export promotion programmes and buyer missions.",
      coverage: "Kenya",
    },
  ],
  "South Africa": [
    {
      id: "dtic",
      name: "Department of Trade, Industry and Competition",
      publisher: "DTIC",
      url: "https://www.thedtic.gov.za/",
      whatYouFind: "Industrial and export notices for SACU offtake.",
      coverage: "South Africa",
    },
  ],
  "Côte d’Ivoire": [
    {
      id: "cepici",
      name: "CEPICI investment and trade window",
      publisher: "CEPICI",
      url: "https://www.cepici.gouv.ci/",
      whatYouFind: "Formal investor/trade window — not Abidjan market WhatsApp.",
      coverage: "Côte d’Ivoire",
    },
  ],
  Senegal: [
    {
      id: "asepex",
      name: "ASEPEX",
      publisher: "Senegal export promotion",
      url: "https://asepex.sn/",
      whatYouFind: "Exporter support and product notices.",
      coverage: "Senegal",
    },
  ],
  Egypt: [
    {
      id: "goeic",
      name: "General Organization for Export and Import Control",
      publisher: "GOEIC",
      url: "https://www.goeic.gov.eg/",
      whatYouFind: "Import/export control circulars.",
      coverage: "Egypt",
    },
  ],
  Ethiopia: [
    {
      id: "moti-et",
      name: "Ministry of Trade and Regional Integration",
      publisher: "Ethiopia",
      url: "https://www.motri.gov.et/",
      whatYouFind: "National trade notices. Ethiopia is not EAC and not full COMESA FTA.",
      coverage: "Ethiopia",
    },
  ],
  Morocco: [
    {
      id: "morocco-trade",
      name: "Morocco trade portal",
      publisher: "Ministry of Industry and Trade",
      url: "https://www.mcinet.gov.ma/",
      whatYouFind: "Export and industry notices. Land border with Algeria remains closed.",
      coverage: "Morocco",
    },
  ],
  Tanzania: [
    {
      id: "tantrade",
      name: "TanTrade",
      publisher: "Tanzania Trade Development Authority",
      url: "https://www.tantrade.go.tz/",
      whatYouFind: "Exporter programmes. EAC CET still applies on extra-union origin.",
      coverage: "Tanzania",
    },
  ],
  Uganda: [
    {
      id: "uganda-export",
      name: "Uganda Export Promotion Board",
      publisher: "UEPB",
      url: "https://ugandaexports.go.ug/",
      whatYouFind: "Export promotion. EAC origin papers still decide preference.",
      coverage: "Uganda",
    },
  ],
  Rwanda: [
    {
      id: "rdb",
      name: "Rwanda Development Board",
      publisher: "RDB",
      url: "https://rdb.rw/",
      whatYouFind: "Investment and export window. EAC CET on extra-union goods.",
      coverage: "Rwanda",
    },
  ],
  Zambia: [
    {
      id: "zda",
      name: "Zambia Development Agency",
      publisher: "ZDA",
      url: "https://www.zda.org.zm/",
      whatYouFind: "Export and investment notices. SADC and COMESA preference is documentary.",
      coverage: "Zambia",
    },
  ],
  Zimbabwe: [
    {
      id: "zimtrade",
      name: "ZimTrade",
      publisher: "Zimbabwe",
      url: "https://www.zimtrade.co.zw/",
      whatYouFind: "Exporter support. SADC/COMESA origin still required.",
      coverage: "Zimbabwe",
    },
  ],
  Botswana: [
    {
      id: "bitc",
      name: "Botswana Investment and Trade Centre",
      publisher: "BITC",
      url: "https://www.bitc.co.bw/",
      whatYouFind: "Export promotion inside SACU. Extra-SACU origin pays CET.",
      coverage: "Botswana",
    },
  ],
  Namibia: [
    {
      id: "namibia-tip",
      name: "Namibia Trade Information Portal",
      publisher: "Namibia",
      url: "https://namibiatradeportal.gov.na/",
      whatYouFind: "SACU circulation rules and trade notices.",
      coverage: "Namibia",
    },
  ],
  Mozambique: [
    {
      id: "apiex",
      name: "APIEX Mozambique",
      publisher: "APIEX",
      url: "https://www.apiex.gov.mz/",
      whatYouFind: "Investment and export window. SADC FTA is origin-documentary.",
      coverage: "Mozambique",
    },
  ],
  Angola: [
    {
      id: "aipex",
      name: "AIPEX Angola",
      publisher: "AIPEX",
      url: "https://www.aipex.gov.ao/",
      whatYouFind: "Investment and export window. SADC FTA, not a CET.",
      coverage: "Angola",
    },
  ],
  Tunisia: [
    {
      id: "cepex",
      name: "CEPEX Tunisia",
      publisher: "CEPEX",
      url: "https://www.cepex.nat.tn/",
      whatYouFind: "Export promotion. COMESA FTA is documentary where it applies.",
      coverage: "Tunisia",
    },
  ],
  Algeria: [
    {
      id: "algex",
      name: "ALGEX",
      publisher: "Algeria",
      url: "https://www.algex.dz/",
      whatYouFind: "Export promotion. Land border with Morocco remains closed.",
      coverage: "Algeria",
    },
  ],
};

function regional(home: string): PublicBoard[] {
  const out: PublicBoard[] = [];
  if (ECOWAS12.has(home) || AES.has(home)) {
    out.push({
      id: "etls",
      name: "ECOWAS ETLS",
      publisher: "ECOWAS",
      url: "https://etls.ecowas.int/",
      whatYouFind: "Origin and free-circulation rules for Community goods. AES members: confirm this week’s booth treatment.",
      coverage: "West Africa",
    });
  }
  if (home === "Cameroon" || home === "Central African Republic" || home === "Chad" || home === "Equatorial Guinea" || home === "Gabon" || home === "Republic of Congo") {
    out.push({
      id: "cemac",
      name: "CEMAC customs union",
      publisher: "CEMAC",
      url: "https://www.cemac.int/",
      whatYouFind: "CET on extra-CEMAC origin. Empty perishable calendars on this desk are intentional.",
      coverage: "Central Africa",
    });
  }
  if (EAC.has(home)) {
    out.push({
      id: "eac",
      name: "EAC Customs Union",
      publisher: "East African Community",
      url: "https://www.eac.int/integration-pillars/customs-union",
      whatYouFind: "CET and origin practice at one-stop border posts.",
      coverage: "East Africa",
    });
  }
  if (SACU.has(home)) {
    out.push({
      id: "sacu",
      name: "SACU market access",
      publisher: "SACU",
      url: "https://www.sacu.int/",
      whatYouFind: "Customs-union circulation rules — extra-SACU origin still pays CET.",
      coverage: "Southern Africa",
    });
  }
  if (MAGHREB.has(home)) {
    out.push({
      id: "afcfta-maghreb",
      name: "AfCFTA origin desk",
      publisher: "AfCFTA Secretariat",
      url: "https://au-afcfta.org/",
      whatYouFind: "Preference is documentary. Algeria–Morocco land border remains closed.",
      coverage: "North Africa",
    });
  }
  if (
    home === "Angola" ||
    home === "Comoros" ||
    home === "Madagascar" ||
    home === "Malawi" ||
    home === "Mauritius" ||
    home === "Mozambique" ||
    home === "Seychelles" ||
    home === "Zambia" ||
    home === "Zimbabwe"
  ) {
    out.push({
      id: "sadc-protocol",
      name: "SADC Protocol on Trade",
      publisher: "SADC",
      url: "https://www.sadc.int/document/protocol-trade-1996",
      whatYouFind: "FTA origin rules — not a customs union CET. Extra-SADC goods pay national tariffs.",
      coverage: "Southern Africa",
    });
  }
  if (
    home === "Comoros" ||
    home === "Djibouti" ||
    home === "Egypt" ||
    home === "Eritrea" ||
    home === "Ethiopia" ||
    home === "Libya" ||
    home === "Madagascar" ||
    home === "Malawi" ||
    home === "Mauritius" ||
    home === "Seychelles" ||
    home === "Sudan" ||
    home === "Tunisia" ||
    home === "Zambia" ||
    home === "Zimbabwe"
  ) {
    out.push({
      id: "comesa-tip",
      name: "COMESA Trade Information Portal",
      publisher: "COMESA",
      url: "https://tradeportal.comesa.int",
      whatYouFind: "FTA notices and origin practice. Ethiopia and Eritrea are not full FTA.",
      coverage: "Eastern and Southern Africa",
    });
  }
  return out;
}

export function boardsFor(home: string): PublicBoard[] {
  const country = BY_HOME[home] || [];
  const seen = new Set<string>();
  return [...country, ...regional(home), ...CONTINENT].filter((board) => {
    if (seen.has(board.id)) return false;
    seen.add(board.id);
    return true;
  });
}
