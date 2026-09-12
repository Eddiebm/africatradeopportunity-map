import type { DeskBrief } from "./types";
import { briefs as DZ } from "./desks/DZ";
import { briefs as AO } from "./desks/AO";
import { briefs as BJ } from "./desks/BJ";
import { briefs as BW } from "./desks/BW";
import { briefs as BF } from "./desks/BF";
import { briefs as BI } from "./desks/BI";
import { briefs as CV } from "./desks/CV";
import { briefs as CM } from "./desks/CM";
import { briefs as CF } from "./desks/CF";
import { briefs as TD } from "./desks/TD";
import { briefs as KM } from "./desks/KM";
import { briefs as CG } from "./desks/CG";
import { briefs as CI } from "./desks/CI";
import { briefs as CD } from "./desks/CD";
import { briefs as DJ } from "./desks/DJ";
import { briefs as EG } from "./desks/EG";
import { briefs as GQ } from "./desks/GQ";
import { briefs as ER } from "./desks/ER";
import { briefs as SZ } from "./desks/SZ";
import { briefs as ET } from "./desks/ET";
import { briefs as GA } from "./desks/GA";
import { briefs as GM } from "./desks/GM";
import { briefs as GH } from "./desks/GH";
import { briefs as GN } from "./desks/GN";
import { briefs as GW } from "./desks/GW";
import { briefs as KE } from "./desks/KE";
import { briefs as LS } from "./desks/LS";
import { briefs as LR } from "./desks/LR";
import { briefs as LY } from "./desks/LY";
import { briefs as MG } from "./desks/MG";
import { briefs as MW } from "./desks/MW";
import { briefs as ML } from "./desks/ML";
import { briefs as MR } from "./desks/MR";
import { briefs as MU } from "./desks/MU";
import { briefs as MA } from "./desks/MA";
import { briefs as MZ } from "./desks/MZ";
import { briefs as NA } from "./desks/NA";
import { briefs as NE } from "./desks/NE";
import { briefs as NG } from "./desks/NG";
import { briefs as RW } from "./desks/RW";
import { briefs as ST } from "./desks/ST";
import { briefs as SN } from "./desks/SN";
import { briefs as SC } from "./desks/SC";
import { briefs as SL } from "./desks/SL";
import { briefs as SO } from "./desks/SO";
import { briefs as ZA } from "./desks/ZA";
import { briefs as SS } from "./desks/SS";
import { briefs as SD } from "./desks/SD";
import { briefs as TZ } from "./desks/TZ";
import { briefs as TG } from "./desks/TG";
import { briefs as TN } from "./desks/TN";
import { briefs as UG } from "./desks/UG";
import { briefs as ZM } from "./desks/ZM";
import { briefs as ZW } from "./desks/ZW";

export const DESK_BRIEFS: Record<string, DeskBrief[]> = {
  'Algeria': DZ,
  'Angola': AO,
  'Benin': BJ,
  'Botswana': BW,
  'Burkina Faso': BF,
  'Burundi': BI,
  'Cabo Verde': CV,
  'Cameroon': CM,
  'Central African Republic': CF,
  'Chad': TD,
  'Comoros': KM,
  'Republic of Congo': CG,
  'Côte d’Ivoire': CI,
  'DR Congo': CD,
  'Djibouti': DJ,
  'Egypt': EG,
  'Equatorial Guinea': GQ,
  'Eritrea': ER,
  'Eswatini': SZ,
  'Ethiopia': ET,
  'Gabon': GA,
  'Gambia': GM,
  'Ghana': GH,
  'Guinea': GN,
  'Guinea-Bissau': GW,
  'Kenya': KE,
  'Lesotho': LS,
  'Liberia': LR,
  'Libya': LY,
  'Madagascar': MG,
  'Malawi': MW,
  'Mali': ML,
  'Mauritania': MR,
  'Mauritius': MU,
  'Morocco': MA,
  'Mozambique': MZ,
  'Namibia': NA,
  'Niger': NE,
  'Nigeria': NG,
  'Rwanda': RW,
  'São Tomé & Príncipe': ST,
  'Senegal': SN,
  'Seychelles': SC,
  'Sierra Leone': SL,
  'Somalia': SO,
  'South Africa': ZA,
  'South Sudan': SS,
  'Sudan': SD,
  'Tanzania': TZ,
  'Togo': TG,
  'Tunisia': TN,
  'Uganda': UG,
  'Zambia': ZM,
  'Zimbabwe': ZW,
};

export const DESK_HOMES: string[] = [
  'Algeria',
  'Angola',
  'Benin',
  'Botswana',
  'Burkina Faso',
  'Burundi',
  'Cabo Verde',
  'Cameroon',
  'Central African Republic',
  'Chad',
  'Comoros',
  'Republic of Congo',
  'Côte d’Ivoire',
  'DR Congo',
  'Djibouti',
  'Egypt',
  'Equatorial Guinea',
  'Eritrea',
  'Eswatini',
  'Ethiopia',
  'Gabon',
  'Gambia',
  'Ghana',
  'Guinea',
  'Guinea-Bissau',
  'Kenya',
  'Lesotho',
  'Liberia',
  'Libya',
  'Madagascar',
  'Malawi',
  'Mali',
  'Mauritania',
  'Mauritius',
  'Morocco',
  'Mozambique',
  'Namibia',
  'Niger',
  'Nigeria',
  'Rwanda',
  'São Tomé & Príncipe',
  'Senegal',
  'Seychelles',
  'Sierra Leone',
  'Somalia',
  'South Africa',
  'South Sudan',
  'Sudan',
  'Tanzania',
  'Togo',
  'Tunisia',
  'Uganda',
  'Zambia',
  'Zimbabwe',
];
