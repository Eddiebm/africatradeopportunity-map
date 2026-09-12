/** HS4-specific ECOWAS CET where the chapter band would mislead. */
const HS4_CET: Record<string, { pct: number; band: string }> = {
  "0702": { pct: 35, band: "fifth / sensitive" },
  "0703": { pct: 35, band: "fifth / sensitive" },
  "0102": { pct: 10, band: "third" },
  "0207": { pct: 35, band: "fifth / sensitive" },
  "1006": { pct: 10, band: "third" },
  "1207": { pct: 5, band: "second" },
  "1509": { pct: 20, band: "fourth" },
  "1801": { pct: 5, band: "second" },
  "2523": { pct: 20, band: "fourth" },
  "2710": { pct: 10, band: "third" },
  "3004": { pct: 0, band: "zero / essential" },
  "7208": { pct: 10, band: "third" },
  "8701": { pct: 5, band: "second" },
};

export type DutySchedule = {
  hsCode: string;
  dutyPct: number;
  band: string;
};

export function cetDuty(hsCode: string): DutySchedule {
  const digits = hsCode.replace(/\D/g, "");
  const hs4 = digits.slice(0, 4);
  const hs2 = digits.slice(0, 2).padStart(2, "0");
  if (hs4.length === 4 && HS4_CET[hs4]) {
    const hit = HS4_CET[hs4];
    return { hsCode: hs4, dutyPct: hit.pct, band: hit.band };
  }
  const chapter = Number(hs2);
  const { pct, band } = chapterBand(chapter);
  return { hsCode: hs2, dutyPct: pct, band };
}

function chapterBand(chapter: number): { pct: number; band: string } {
  if (chapter === 2 || chapter === 4 || chapter === 7 || chapter === 10 || chapter === 17) {
    return { pct: 35, band: "chapter sensitive band" };
  }
  if (chapter >= 1 && chapter <= 5) return { pct: 10, band: "live animals / meat chapter" };
  if (chapter >= 6 && chapter <= 14) return { pct: 20, band: "plants / food chapter" };
  if (chapter === 15) return { pct: 20, band: "fats and oils chapter" };
  if (chapter >= 16 && chapter <= 24) return { pct: 20, band: "prepared food chapter" };
  if (chapter >= 25 && chapter <= 27) return { pct: 10, band: "minerals / fuels chapter" };
  if (chapter === 30) return { pct: 0, band: "pharmaceuticals chapter" };
  if (chapter >= 28 && chapter <= 38) return { pct: 5, band: "chemicals chapter" };
  if (chapter >= 39 && chapter <= 40) return { pct: 10, band: "plastics / rubber chapter" };
  if (chapter >= 41 && chapter <= 43) return { pct: 10, band: "hides / leather chapter" };
  if (chapter >= 44 && chapter <= 49) return { pct: 10, band: "wood / paper chapter" };
  if (chapter >= 50 && chapter <= 63) return { pct: 20, band: "textiles chapter" };
  if (chapter >= 64 && chapter <= 67) return { pct: 20, band: "footwear / headgear chapter" };
  if (chapter >= 68 && chapter <= 70) return { pct: 20, band: "stone / glass chapter" };
  if (chapter === 71) return { pct: 10, band: "precious metals chapter" };
  if (chapter >= 72 && chapter <= 83) return { pct: 10, band: "base metals chapter" };
  if (chapter >= 84 && chapter <= 85) return { pct: 5, band: "machinery / electrical chapter" };
  if (chapter >= 86 && chapter <= 89) return { pct: 10, band: "vehicles / transport chapter" };
  if (chapter >= 90 && chapter <= 97) return { pct: 10, band: "instruments / miscellaneous chapter" };
  return { pct: 10, band: "unlisted chapter — confirm HS6" };
}

const ECOWAS = new Set([
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

const UEMOA = new Set([
  "Benin",
  "Burkina Faso",
  "Côte d’Ivoire",
  "Guinea-Bissau",
  "Mali",
  "Niger",
  "Senegal",
  "Togo",
]);

export function isEcowas(country: string): boolean {
  return ECOWAS.has(country);
}

export function isUemoa(country: string): boolean {
  return UEMOA.has(country);
}

/** Intra-union screening assumes origin proof. CET still applies without it. AES left ECOWAS 29 Jan 2025. */
export function screeningDuty(hsCode: string, origin: string, destination: string): DutySchedule {
  const cet = cetDuty(hsCode);
  if (origin && destination && origin !== destination && isUemoa(origin) && isUemoa(destination)) {
    return {
      hsCode: cet.hsCode,
      dutyPct: 0,
      band: `UEMOA assumed 0%. CET ${cet.dutyPct}% (${cet.band}) without origin proof`,
    };
  }
  if (origin && destination && origin !== destination && isEcowas(origin) && isEcowas(destination)) {
    return {
      hsCode: cet.hsCode,
      dutyPct: 0,
      band: `ETLS assumed 0%. CET ${cet.dutyPct}% (${cet.band}) without origin proof`,
    };
  }
  return cet;
}

/** Standard VAT rates used as a schedule, not a live tax ruling. */
const AFRICA_VAT: Record<string, { pct: number; note: string }> = {
  Algeria: { pct: 19, note: "Algeria standard VAT 19%." },
  Angola: { pct: 14, note: "Angola standard VAT 14%." },
  Benin: { pct: 18, note: "Benin standard VAT 18%." },
  Botswana: { pct: 14, note: "Botswana VAT 14%." },
  "Burkina Faso": { pct: 18, note: "Burkina Faso standard VAT 18%." },
  Burundi: { pct: 18, note: "Burundi standard VAT 18%." },
  "Cabo Verde": { pct: 15, note: "Cabo Verde VAT 15%." },
  Cameroon: { pct: 19.25, note: "Cameroon VAT 19.25%." },
  "Central African Republic": { pct: 19, note: "CAR standard VAT 19%." },
  Chad: { pct: 18, note: "Chad standard VAT 18%." },
  Comoros: { pct: 10, note: "Comoros VAT 10%." },
  "Republic of Congo": { pct: 16, note: "Congo VAT 16%." },
  "Côte d’Ivoire": { pct: 18, note: "Côte d’Ivoire standard VAT 18%." },
  "DR Congo": { pct: 16, note: "DRC VAT 16%." },
  Djibouti: { pct: 10, note: "Djibouti VAT 10%." },
  Egypt: { pct: 14, note: "Egypt VAT 14%." },
  "Equatorial Guinea": { pct: 15, note: "Equatorial Guinea VAT 15%." },
  Eritrea: { pct: 5, note: "Eritrea sales tax 5% (confirm locally)." },
  Eswatini: { pct: 15, note: "Eswatini VAT 15%." },
  Ethiopia: { pct: 15, note: "Ethiopia VAT 15%." },
  Gabon: { pct: 18, note: "Gabon VAT 18%." },
  Gambia: { pct: 15, note: "Gambia VAT 15%." },
  Ghana: { pct: 15, note: "Ghana VAT 15% (GRA). Levies may apply on top." },
  Guinea: { pct: 18, note: "Guinea VAT 18%." },
  "Guinea-Bissau": { pct: 15, note: "Guinea-Bissau VAT 15%." },
  Kenya: { pct: 16, note: "Kenya VAT 16%." },
  Lesotho: { pct: 15, note: "Lesotho VAT 15%." },
  Liberia: { pct: 10, note: "Liberia GST 10%." },
  Libya: { pct: 0, note: "Libya has no general VAT — confirm local levies." },
  Madagascar: { pct: 20, note: "Madagascar VAT 20%." },
  Malawi: { pct: 16.5, note: "Malawi VAT 16.5%." },
  Mali: { pct: 18, note: "Mali standard VAT 18%." },
  Mauritania: { pct: 16, note: "Mauritania VAT 16%." },
  Mauritius: { pct: 15, note: "Mauritius VAT 15%." },
  Morocco: { pct: 20, note: "Morocco standard VAT 20%." },
  Mozambique: { pct: 16, note: "Mozambique VAT 16%." },
  Namibia: { pct: 15, note: "Namibia VAT 15%." },
  Niger: { pct: 19, note: "Niger VAT 19%." },
  Nigeria: { pct: 7.5, note: "Nigeria VAT 7.5%." },
  Rwanda: { pct: 18, note: "Rwanda VAT 18%." },
  "São Tomé & Príncipe": { pct: 15, note: "São Tomé VAT 15%." },
  Senegal: { pct: 18, note: "Senegal standard VAT 18%." },
  Seychelles: { pct: 15, note: "Seychelles VAT 15%." },
  "Sierra Leone": { pct: 15, note: "Sierra Leone GST 15%." },
  Somalia: { pct: 5, note: "Somalia sales tax — confirm locally." },
  "South Africa": { pct: 15, note: "South Africa VAT 15%." },
  "South Sudan": { pct: 18, note: "South Sudan VAT 18%." },
  Sudan: { pct: 17, note: "Sudan VAT 17%." },
  Tanzania: { pct: 18, note: "Tanzania VAT 18%." },
  Togo: { pct: 18, note: "Togo standard VAT 18%." },
  Tunisia: { pct: 19, note: "Tunisia VAT 19%." },
  Uganda: { pct: 18, note: "Uganda VAT 18%." },
  Zambia: { pct: 16, note: "Zambia VAT 16%." },
  Zimbabwe: { pct: 15, note: "Zimbabwe VAT 15%." },
};

export function destinationVat(destination: string): { pct: number; label: string; url: string } {
  const row = AFRICA_VAT[destination];
  if (row) {
    return { pct: row.pct, label: row.note, url: "https://www.oecd.org/tax/" };
  }
  return {
    pct: 15,
    label: `No stored VAT for ${destination}; using 15% as a placeholder. Confirm locally.`,
    url: "https://wits.worldbank.org/",
  };
}

export const CET_SOURCE = {
  name: "ECOWAS CET chapter band (confirm HS6 with a broker)",
  url: "https://www.ecowas.int/",
  asOf: "2024-01-01",
};
