import { cite, type PublicationId } from "./publications";
import { ALL_YEAR, isCompleteBrief, type ClaimStatus, type DeskBrief, type Stance } from "./types";

const ECOWAS12 = [
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
] as const;

const AES = ["Burkina Faso", "Mali", "Niger"] as const;

const SACU = ["Botswana", "Eswatini", "Lesotho", "Namibia", "South Africa"] as const;

const EAC = [
  "Burundi",
  "DR Congo",
  "Kenya",
  "Rwanda",
  "Somalia",
  "South Sudan",
  "Tanzania",
  "Uganda",
] as const;

const CEMAC = [
  "Cameroon",
  "Central African Republic",
  "Chad",
  "Equatorial Guinea",
  "Gabon",
  "Republic of Congo",
] as const;

/** SADC members that are not already screened as SACU (CET) or EAC (CET). */
const SADC_FTA = [
  "Angola",
  "Comoros",
  "Madagascar",
  "Malawi",
  "Mauritius",
  "Mozambique",
  "Seychelles",
  "Zambia",
  "Zimbabwe",
] as const;

/** COMESA members that are not already screened as EAC or SACU. */
const COMESA_FTA = [
  "Comoros",
  "Djibouti",
  "Egypt",
  "Eritrea",
  "Ethiopia",
  "Libya",
  "Madagascar",
  "Malawi",
  "Mauritius",
  "Seychelles",
  "Sudan",
  "Tunisia",
  "Zambia",
  "Zimbabwe",
] as const;

type Role = {
  home: string;
  stance: Stance;
  countries: string[];
  origin?: string;
  destination?: string;
  headline: string;
  why: string;
};

type Corridor = {
  id: string;
  product: string;
  hsCode: string;
  months: number[];
  monthLabel: string;
  measured: string;
  status: ClaimStatus;
  sources: PublicationId[];
  watch: string;
  roles: Role[];
};

const TOMATO_LEAN = [12, 1, 2, 3, 4];
const TOMATO_GLUT = [6, 7, 8, 9, 10];

const CORRIDORS: Corridor[] = [
  {
    id: "tamale-tomatoes-lean",
    product: "Tomatoes",
    hsCode: "0702",
    months: TOMATO_LEAN,
    monthLabel: "December–April",
    measured:
      "OECD/SWAC Map 2.2: in Tamale’s lean season approximately 90% of tomatoes come from Burkina Faso; in Ghana’s peak the same market is entirely domestic. Burkina Faso exported 73% of its tomato production to the regional market (2014–20 average). Ghana’s National Tomato Trader and Transport Association reports ~100 000 tonnes of regional tomato imports a year versus 1 700 tonnes in recorded-plus-ECO-ICBT data for 2022. IFPRI: Upper East irrigated harvest is late December–April and too small for national demand.",
    status: "research_calendar",
    sources: ["oecdSwac2025", "oecdSwacBooklet2025", "ifpriVeg2018"],
    watch:
      "Phytosanitary papers. Confirm this week’s Paga/Hamile queue. AES left ECOWAS on 29 January 2025 — do not assume ETLS duty-free on a Ghana–Burkina truck. This is a screening window, not a bid.",
    roles: [
      {
        home: "Ghana",
        stance: "buy",
        countries: ["Burkina Faso"],
        origin: "Burkina Faso",
        destination: "Ghana",
        headline: "If you live in Ghana, consider tomatoes from Burkina Faso during December–April.",
        why: "Ghana’s lean in Tamale. OECD/SWAC: approximately 90% of tomatoes in that market come from Burkina Faso in the lean. NTTT: ~100 000 tonnes of regional imports a year versus 1 700 tonnes in compiled 2022 data. IFPRI: Upper East irrigated supply (late December–April) does not fill national demand.",
      },
      {
        home: "Burkina Faso",
        stance: "sell",
        countries: ["Ghana"],
        origin: "Burkina Faso",
        destination: "Ghana",
        headline: "If you live in Burkina Faso, consider selling tomatoes to Ghana during December–April.",
        why: "This is Ghana’s lean, not Burkina’s inbound. OECD/SWAC: Tamale takes ~90% Burkina tomatoes in the lean and is fully Ghanaian in the peak. Burkina exported 73% of tomato production to the regional market (2014–20). Do not reverse the truck in Ghana’s harvest.",
      },
    ],
  },
  {
    id: "tamale-tomatoes-peak",
    product: "Tomatoes",
    hsCode: "0702",
    months: TOMATO_GLUT,
    monthLabel: "June–October",
    measured:
      "OECD/SWAC: Tamale tomato supply is entirely domestic in Ghana’s peak. IFPRI: rainfed harvest runs June–October in Northern, Brong Ahafo and Ashanti.",
    status: "research_calendar",
    sources: ["oecdSwac2025", "ifpriVeg2018"],
    watch:
      "Inbound Burkina trucks compete with glut prices and still pay spoilage, freight and destination VAT. Annual Comtrade averages hide this split.",
    roles: [
      {
        home: "Ghana",
        stance: "avoid",
        countries: ["Burkina Faso"],
        origin: "Burkina Faso",
        destination: "Ghana",
        headline: "If you live in Ghana, do not bring Burkina tomatoes in during June–October.",
        why: "Peak domestic harvest. OECD/SWAC: Tamale is fully local in the peak. IFPRI: rainfed south and north supply June–October.",
      },
      {
        home: "Burkina Faso",
        stance: "avoid",
        countries: ["Ghana"],
        origin: "Burkina Faso",
        destination: "Ghana",
        headline: "If you live in Burkina Faso, do not push tomatoes into Ghana during June–October.",
        why: "Ghana’s rainfed harvest. OECD/SWAC peak: Tamale does not need Burkina fruit. Selling into a glut is a screening loss unless a named buyer has already priced this week.",
      },
    ],
  },
  {
    id: "onions-ne-bf-gh",
    product: "Onions",
    hsCode: "0703",
    months: ALL_YEAR,
    monthLabel: "all year (Ghana gap widest April–June)",
    measured:
      "OECD/SWAC: Niger supplies 68% of onions traded regionally (2014–22 average), mainly to Ghana (64% of Niger’s regional onion exports), Côte d’Ivoire (23%) and Benin (6.5%). Ghana, Benin and Togo import 75%, 63% and 47% of their onions from Niger. SOFRECO via OECD: Niger exported an estimated 364 400 tonnes in 2020 — four times official; export-to-production could be 50–95%. Map 2.2: Tamale onions follow a lean/peak origin split like tomatoes (regional flows likely understated). IFPRI 2018: Niger and Burkina dominate Ghana’s onion market year-round; Ghana has almost no local production in April–June.",
    status: "research_calendar",
    sources: ["ifpriVeg2018", "oecdSwac2025", "oecdSwacBooklet2025"],
    watch:
      "OECD notes Sahel routes have been disrupted; confirm this week’s road, not last year’s map. Origin papers still decide preference. Not a bid.",
    roles: [
      {
        home: "Ghana",
        stance: "buy",
        countries: ["Niger", "Burkina Faso"],
        origin: "Burkina Faso",
        destination: "Ghana",
        headline: "If you live in Ghana, consider onions from Niger and Burkina Faso — year-round, strongest when local supply is thinnest.",
        why: "OECD/SWAC: Ghana takes 64% of Niger’s regional onion exports and imports 75% of its onions from Niger. IFPRI: Niger and Burkina dominate the Ghana onion market all year; April–June is almost empty locally.",
      },
      {
        home: "Burkina Faso",
        stance: "sell",
        countries: ["Ghana"],
        origin: "Burkina Faso",
        destination: "Ghana",
        headline: "If you live in Burkina Faso, consider selling onions to Ghana year-round.",
        why: "IFPRI: Burkina (with Niger) dominates Ghana’s onion market all year. OECD/SWAC maps Tamale’s off-season as regional. Sell Burkina-origin sacks — do not assume Niger transit is sitting in Ouagadougou. Niger, not Burkina, is the OECD’s 68% regional onion exporter.",
      },
      {
        home: "Niger",
        stance: "sell",
        countries: ["Ghana"],
        origin: "Niger",
        destination: "Ghana",
        headline: "If you live in Niger, consider selling onions to Ghana year-round.",
        why: "OECD/SWAC: Niger is 68% of regional onion trade; Ghana is 64% of Niger’s regional onion exports. SOFRECO via OECD: ~364 400 tonnes in 2020. Confirm the current road (Nigeria/Togo reroutes have already happened).",
      },
      {
        home: "Côte d’Ivoire",
        stance: "buy",
        countries: ["Niger"],
        origin: "Niger",
        destination: "Côte d’Ivoire",
        headline: "If you live in Côte d’Ivoire, consider onions from Niger — OECD’s second regional destination after Ghana.",
        why: "OECD/SWAC: Côte d’Ivoire takes 23% of Niger’s regional onion exports (Ghana 64%, Benin 6.5%). Niger is 68% of onions traded regionally. This is a 2014–22 average, not this week’s sack price.",
      },
      {
        home: "Benin",
        stance: "buy",
        countries: ["Niger"],
        origin: "Niger",
        destination: "Benin",
        headline: "If you live in Benin, consider onions from Niger — OECD’s third coastal offtake.",
        why: "OECD/SWAC: Benin takes 6.5% of Niger’s regional onion exports and imports 63% of its onions from Niger. Not a Cotonou bid.",
      },
      {
        home: "Togo",
        stance: "buy",
        countries: ["Niger"],
        origin: "Niger",
        destination: "Togo",
        headline: "If you live in Togo, consider onions from Niger — about half of Togo’s onion imports in the OECD print.",
        why: "OECD/SWAC: Togo imports 47% of its onions from Niger (Ghana 75%, Benin 63%). Confirm the Lomé road this week.",
      },
    ],
  },
  {
    id: "live-bovine-undercount",
    product: "Live cattle",
    hsCode: "0102",
    months: ALL_YEAR,
    monthLabel: "all year (official figures undercount)",
    measured:
      "OECD/SWAC 2025, 2014–22 average: Burkina recorded live-bovine exports USD 2 million — 1% of the study estimate (USD 250 million). Niger recorded USD 17 million — 4% of USD 450 million estimated. Mali recorded USD 62 million — 21% of USD 298 million estimated. Benin, Côte d’Ivoire and Togo official regional cattle exports are near 0%; unrecorded averages are USD 29 million, USD 8 million and USD 7 million.",
    status: "research_calendar",
    sources: ["oecdSwac2025", "oecdSwacBooklet2025"],
    watch:
      "Veterinary certificates and movement permits. Drought and security reverse flows. This desk does not invent a month window — OECD measured undercounting, not a harvest calendar. Not a bid.",
    roles: [
      {
        home: "Burkina Faso",
        stance: "sell",
        countries: ["Ghana", "Côte d’Ivoire", "Nigeria"],
        origin: "Burkina Faso",
        destination: "Ghana",
        headline: "If you live in Burkina Faso, treat live cattle to the coast as a standing corridor — official export figures miss almost all of it.",
        why: "OECD/SWAC: Burkina recorded live-bovine exports USD 2 million — 1% of the USD 250 million estimate. The animals move; the statistics do not. Get a dated bid, not a Comtrade unit value.",
      },
      {
        home: "Niger",
        stance: "sell",
        countries: ["Nigeria", "Ghana"],
        origin: "Niger",
        destination: "Nigeria",
        headline: "If you live in Niger, treat live cattle as a standing regional corridor — official figures show about 4% of estimated trade.",
        why: "OECD/SWAC: Niger recorded live-bovine exports USD 17 million — 4% of the USD 450 million estimate. Nigeria is the dense coastal offtake in the same report’s food-flow maps.",
      },
      {
        home: "Mali",
        stance: "sell",
        countries: ["Côte d’Ivoire", "Ghana"],
        origin: "Mali",
        destination: "Côte d’Ivoire",
        headline: "If you live in Mali, treat live cattle to the coast as a standing corridor — official figures show about 21% of estimated trade.",
        why: "OECD/SWAC: Mali recorded live-bovine exports USD 62 million — 21% of the USD 298 million estimate. Still a large miss, smaller than Burkina or Niger’s gap.",
      },
      {
        home: "Guinea",
        stance: "sell",
        countries: ["Côte d’Ivoire", "Senegal"],
        origin: "Guinea",
        destination: "Côte d’Ivoire",
        headline: "If you live in Guinea, official statistics show zero live-animal exports — the cattle still move.",
        why: "OECD/SWAC: official live-animal exports 2014–22 were zero. ECO-ICBT still counted about USD 23 million a year of live bovines — four times all of Guinea’s recorded regional food exports (USD 6.8 million).",
      },
      {
        home: "Benin",
        stance: "sell",
        countries: ["Nigeria"],
        origin: "Benin",
        destination: "Nigeria",
        headline: "If you live in Benin, treat live cattle as a standing corridor official records put near zero.",
        why: "OECD/SWAC: official Benin regional live-bovine exports are near 0%; unrecorded trade averages about USD 29 million a year.",
      },
      {
        home: "Togo",
        stance: "sell",
        countries: ["Ghana", "Burkina Faso"],
        origin: "Togo",
        destination: "Ghana",
        headline: "If you live in Togo, treat live cattle as a standing corridor official records put near zero.",
        why: "OECD/SWAC: official Togo regional live-bovine exports are near 0%; unrecorded trade averages about USD 7 million a year.",
      },
      {
        home: "Ghana",
        stance: "buy",
        countries: ["Burkina Faso", "Mali"],
        origin: "Burkina Faso",
        destination: "Ghana",
        headline: "If you live in Ghana, consider cattle from Burkina Faso and Mali as a standing Sahel-to-coast corridor — not a Comtrade line.",
        why: "OECD/SWAC documents massive under-recording of live bovines from Burkina (1% official) and Mali (21%). The desk will not pretend a month is proven; it will not pretend official tonnes are the market.",
      },
      {
        home: "Côte d’Ivoire",
        stance: "buy",
        countries: ["Burkina Faso", "Mali"],
        origin: "Mali",
        destination: "Côte d’Ivoire",
        headline: "If you live in Côte d’Ivoire, consider cattle from Mali and Burkina Faso as a standing corridor whose official tonnes are not the market.",
        why: "OECD/SWAC live-bovine undercount: Burkina ~1%, Mali ~21% of estimated regional trade. Coastal offtake is the reason those animals walk.",
      },
      {
        home: "Nigeria",
        stance: "buy",
        countries: ["Niger", "Burkina Faso"],
        origin: "Niger",
        destination: "Nigeria",
        headline: "If you live in Nigeria, consider live cattle from Niger and Burkina Faso as a standing corridor missing from official trade.",
        why: "OECD/SWAC: Niger official live-bovine exports ~4% of estimated trade; Burkina ~1%. The same study finds Nigeria a dense destination for unrecorded regional food, including live bovines.",
      },
    ],
  },
  {
    id: "ghana-salt-2501",
    product: "Salt",
    hsCode: "2501",
    months: ALL_YEAR,
    monthLabel: "all year (recorded 2024 print)",
    measured:
      "OEC / Comtrade 2024: Ghana exported USD 1.13 million of salt (HS 2501). Top destinations were Burkina Faso USD 475k, Benin USD 212k, Togo USD 203k and Niger USD 200k. The same year Ghana imported USD 6.63 million, mainly from Egypt USD 2.78 million and Namibia USD 2.04 million — recorded Ghana is a net salt importer.",
    status: "official_print",
    sources: ["oecGhanaSalt2024"],
    watch:
      "Ada/Songor is industrialising. Recorded dollars miss informal 50kg bags. Iodisation, origin papers and a dated mill bid still decide. This is a print, not a quote.",
    roles: [
      {
        home: "Ghana",
        stance: "sell",
        countries: ["Burkina Faso", "Benin", "Togo", "Niger"],
        origin: "Ghana",
        destination: "Burkina Faso",
        headline: "If you live in Ghana, consider selling salt to Burkina Faso, Benin, Togo and Niger — they are the recorded 2024 destinations.",
        why: "OEC / Comtrade 2024: USD 1.13 million of Ghana salt exports, with Burkina Faso the largest recorded buyer at USD 475k. Benin, Togo and Niger follow. Get a mill bid; do not treat the annual print as this week’s bag price.",
      },
      {
        home: "Burkina Faso",
        stance: "buy",
        countries: ["Ghana"],
        origin: "Ghana",
        destination: "Burkina Faso",
        headline: "If you live in Burkina Faso, consider salt from Ghana — the largest recorded 2024 destination for Ghana’s HS 2501 exports.",
        why: "OEC / Comtrade 2024: Burkina Faso took USD 475k of Ghana’s USD 1.13 million recorded salt exports. Confirm iodised grade and origin papers; AES/ECOWAS treatment is a booth question this week.",
      },
      {
        home: "Ghana",
        stance: "buy",
        countries: ["Namibia", "Egypt"],
        origin: "Namibia",
        destination: "Ghana",
        headline: "If you live in Ghana, also consider salt from Namibia and Egypt — recorded imports dwarf recorded exports.",
        why: "OEC / Comtrade 2024: Ghana imported USD 6.63 million of salt versus USD 1.13 million exported. Egypt USD 2.78 million and Namibia USD 2.04 million were the main recorded origins. Industrial users may not be buying Ada bags.",
      },
      {
        home: "Namibia",
        stance: "sell",
        countries: ["Ghana"],
        origin: "Namibia",
        destination: "Ghana",
        headline: "If you live in Namibia, Ghana is a recorded salt offtake — USD 2.04 million in 2024.",
        why: "OEC / Comtrade 2024: Namibia was Ghana’s second recorded salt origin after Egypt. This is an official HS 2501 line, not a Walvis Bay bid.",
      },
    ],
  },
  {
    id: "tomato-market-size",
    product: "Tomatoes",
    hsCode: "0702",
    months: ALL_YEAR,
    monthLabel: "all year (recorded vs unrecorded)",
    measured:
      "OECD/SWAC: recorded regional tomato imports about USD 30 million a year (only Ghana, Côte d’Ivoire and Niger appear). With unrecorded trade the market is about USD 111 million — nearly 4× official. Import shares once informal flows are counted: Ghana+Niger+Côte d’Ivoire together 44%; Nigeria 32%; Burkina Faso 13%. Ghana NTTT: ~100 000 tonnes a year versus 1 700 tonnes in the study’s 2022 compiled data.",
    status: "research_calendar",
    sources: ["oecdSwac2025"],
    watch:
      "This is a market-size fact, not a harvest calendar. A yearly dollar is not a bid. Get a dated quote.",
    roles: [
      {
        home: "Nigeria",
        stance: "buy",
        countries: ["Burkina Faso", "Niger"],
        origin: "Burkina Faso",
        destination: "Nigeria",
        headline: "If you live in Nigeria, consider regional tomatoes — official import stats miss most of the market.",
        why: "OECD/SWAC: once unrecorded trade is counted, Nigeria is about 32% of the regional tomato import market. Recorded statistics barely show this.",
      },
      {
        home: "Côte d’Ivoire",
        stance: "buy",
        countries: ["Burkina Faso"],
        origin: "Burkina Faso",
        destination: "Côte d’Ivoire",
        headline: "If you live in Côte d’Ivoire, consider regional tomatoes — you are one of three countries that even appear in official import stats.",
        why: "OECD/SWAC: recorded tomato imports are only Ghana, Côte d’Ivoire and Niger, totalling about USD 30 million. The real regional market is about USD 111 million.",
      },
      {
        home: "Niger",
        stance: "buy",
        countries: ["Burkina Faso", "Nigeria"],
        origin: "Burkina Faso",
        destination: "Niger",
        headline: "If you live in Niger, consider tomatoes as a two-way regional market — official imports exist, and unrecorded flows are larger.",
        why: "OECD/SWAC lists Niger among the three recorded regional tomato importers, then shows the market nearly quadrupling once informal trade is added.",
      },
    ],
  },
  {
    id: "bf-nigeria-food",
    product: "Regional food (tomatoes, onions, livestock and staples)",
    hsCode: "07",
    months: ALL_YEAR,
    monthLabel: "all year (2014 snapshot)",
    measured:
      "OECD/SWAC Figure 1.24 (2014): recorded Burkina regional food exports put Ghana first (~USD 47 million) and Nigeria last (~USD 2 million). Once unrecorded trade is added, Nigeria is first (~USD 316 million) — about six times Ghana (~USD 60 million). The USD 1.5 billion figure in the same chapter is Nigeria–Niger, not Burkina–Nigeria.",
    status: "research_calendar",
    sources: ["oecdSwac2025", "oecdSwacBooklet2025"],
    watch:
      "This is a 2014 food-trade total, not a tomato bid. AES/ECOWAS papers changed in 2025. Confirm the booth this week.",
    roles: [
      {
        home: "Burkina Faso",
        stance: "sell",
        countries: ["Nigeria"],
        origin: "Burkina Faso",
        destination: "Nigeria",
        headline: "If you live in Burkina Faso, Nigeria is the large food offtake official stats almost omit — not Ghana.",
        why: "OECD/SWAC Figure 1.24 (2014): with unrecorded trade, Nigeria takes ~USD 316 million of Burkina regional food exports versus Ghana ~USD 60 million. Recorded Nigeria was ~USD 2 million. Do not size a truck from Comtrade.",
      },
      {
        home: "Nigeria",
        stance: "buy",
        countries: ["Burkina Faso"],
        origin: "Burkina Faso",
        destination: "Nigeria",
        headline: "If you live in Nigeria, Burkina Faso is a major food origin that official stats put near last.",
        why: "OECD/SWAC Figure 1.24 (2014): recorded Burkina food exports to Nigeria ~USD 2 million; with unrecorded trade ~USD 316 million, six times Ghana. AES papers changed in 2025.",
      },
    ],
  },
  {
    id: "ne-nigeria-food",
    product: "Regional food (live animals, cereals and staples)",
    hsCode: "07",
    months: ALL_YEAR,
    monthLabel: "all year (2014 snapshot)",
    measured:
      "OECD/SWAC: official 2014 data show Nigeria traded USD 29 million of food with Niger (8% of Nigeria’s regional exports). With unrecorded trade, Niger is Nigeria’s primary food partner that year (62%), estimated at USD 1.5 billion — still undervalued. This is Nigeria–Niger, not Burkina–Nigeria.",
    status: "research_calendar",
    sources: ["oecdSwac2025", "oecdSwacBooklet2025"],
    watch:
      "The USD 1.5 billion is a 2014 food-trade total, not a cattle bid. Confirm the current road and booth papers.",
    roles: [
      {
        home: "Niger",
        stance: "sell",
        countries: ["Nigeria"],
        origin: "Niger",
        destination: "Nigeria",
        headline: "If you live in Niger, Nigeria is the large food offtake official stats almost omit.",
        why: "OECD/SWAC: USD 29 million recorded with Nigeria in 2014 versus about USD 1.5 billion once unrecorded trade is counted (62% of Nigeria’s regional food trade that year). Do not size a truck from Comtrade.",
      },
      {
        home: "Nigeria",
        stance: "buy",
        countries: ["Niger"],
        origin: "Niger",
        destination: "Nigeria",
        headline: "If you live in Nigeria, Niger is the food partner official 2014 stats understate by about 50×.",
        why: "OECD/SWAC: USD 29 million recorded versus USD 1.5 billion estimated with unrecorded trade. Hausa corridor; still not a bid.",
      },
    ],
  },
  {
    id: "bamako-regional-food",
    product: "Plantain, avocado, yam, cassava and fish",
    hsCode: "08",
    months: ALL_YEAR,
    monthLabel: "all year",
    measured:
      "OECD/SWAC citing UrbanFoodPlus: traced regional inflows are 12% of Bamako’s food and 14% of Ouagadougou’s; another 18% (Bamako) and 9% (Ouagadougou) come from border markets within 35 km — the report’s 23–30% headline. Bamako item shares from the region: plantain 97%, avocados 96%, yam 67%, fish 67%, cassava 50%. Ouagadougou: avocados 96%, oranges 57%, onions 54%.",
    status: "research_calendar",
    sources: ["oecdSwac2025", "oecdSwacBooklet2025"],
    watch:
      "These are city-supply shares, not farmgate prices. Named offtaker in Bamako before you load. SPS still applies.",
    roles: [
      {
        home: "Mali",
        stance: "buy",
        countries: ["Côte d’Ivoire", "Guinea", "Burkina Faso"],
        origin: "Côte d’Ivoire",
        destination: "Mali",
        headline: "If you live in Mali, Bamako’s plantain, avocado, yam and cassava are mostly regional — not Malian harvest.",
        why: "OECD/SWAC: 97% of plantain and 96% of avocados consumed in Bamako are brought in through regional trade; yam and fish 67%, cassava 50%. Close to a third of the city’s food is regional.",
      },
      {
        home: "Côte d’Ivoire",
        stance: "sell",
        countries: ["Mali"],
        origin: "Côte d’Ivoire",
        destination: "Mali",
        headline: "If you live in Côte d’Ivoire, Bamako is a documented offtake for regional plantain and other foods.",
        why: "OECD/SWAC: Bamako takes 97% of its plantain from regional trade. Coastal surplus feeding a Sahel capital is the measured pattern — still not a bid.",
      },
      {
        home: "Burkina Faso",
        stance: "buy",
        countries: ["Côte d’Ivoire", "Ghana"],
        origin: "Côte d’Ivoire",
        destination: "Burkina Faso",
        headline: "If you live in Burkina Faso, Ouagadougou’s avocados and onions are largely regional — not a local harvest story.",
        why: "OECD/SWAC UrbanFoodPlus: 96% of avocados, 57% of oranges and 54% of onions entering Ouagadougou come from West Africa. Traced regional inflows are 14% of city food, plus 9% from border markets.",
      },
    ],
  },
  {
    id: "senegal-onion-netherlands",
    product: "Onions",
    hsCode: "0703",
    months: ALL_YEAR,
    monthLabel: "all year (extra-regional offtake)",
    measured:
      "OECD/SWAC: about one-third of West Africa’s onion imports are regional, skewed by Senegal (27% of regional onion import value), which imports three-quarters of its onions from the Netherlands.",
    status: "research_calendar",
    sources: ["oecdSwac2025"],
    watch:
      "Dakar demand is not a Niger ETLS window. Dutch origin pays CET unless a preference paper exists. Not a bid.",
    roles: [
      {
        home: "Senegal",
        stance: "avoid",
        countries: ["Niger", "Netherlands"],
        origin: "Niger",
        destination: "Senegal",
        headline: "If you live in Senegal, do not treat onion demand as a Niger or ETLS offtake.",
        why: "OECD/SWAC: Senegal is the region’s largest onion importer by recorded share, and three-quarters of those imports come from the Netherlands — not from Niger, which dominates Ghana, Benin and Togo.",
      },
    ],
  },
  {
    id: "cabo-verde-no-land",
    product: "Regional food assumed to arrive by land",
    hsCode: "07",
    months: ALL_YEAR,
    monthLabel: "all year",
    measured:
      "OECD/SWAC: share of food traded with bordering countries, 2014–22: Cabo Verde 0% (islands). Compare Benin 92%, Mali 93%, Burkina Faso 81%, Ghana 52%.",
    status: "research_calendar",
    sources: ["oecdSwac2025"],
    watch:
      "Sea and air are a different investigation. This brief is only the land-corridor assumption.",
    roles: [
      {
        home: "Cabo Verde",
        stance: "avoid",
        countries: ["Senegal", "Gambia"],
        origin: "Senegal",
        destination: "Cabo Verde",
        headline: "If you live in Cabo Verde, do not plan a land truck as if Praia sat on a West African road corridor.",
        why: "OECD/SWAC: Cabo Verde trades 0% of food with bordering countries. Island supply is maritime. Empty harvest months here are not an unfinished file.",
      },
    ],
  },
];

function blocMeasured(home: string): string {
  if ((AES as readonly string[]).includes(home)) {
    return `${home} is AES (left ECOWAS 29 January 2025). Sourced perishable corridors exist only where OECD/SWAC or IFPRI names the flow.`;
  }
  if ((ECOWAS12 as readonly string[]).includes(home)) {
    return `${home} is ECOWAS. CET 0/5/10/20/35. ETLS is documentary. OECD/SWAC 2014–22 covers this home; harvest months still need a named source.`;
  }
  if ((SACU as readonly string[]).includes(home)) {
    return `${home} is SACU (single customs territory with CET on extra-SACU goods). No OECD Tamale-style perishable calendar on this home.`;
  }
  if ((EAC as readonly string[]).includes(home)) {
    return `${home} is EAC Customs Union (CET on extra-EAC origin since 2005). No OECD West Africa perishable calendar on this home.`;
  }
  if ((CEMAC as readonly string[]).includes(home)) {
    return `${home} is CEMAC (CET on extra-union goods). No OECD-style perishable calendar for Central Africa.`;
  }
  if ((SADC_FTA as readonly string[]).includes(home) && (COMESA_FTA as readonly string[]).includes(home)) {
    return `${home} is in the SADC FTA and COMESA FTA — both origin-documentary, neither is a CET. Empty harvest columns are intentional.`;
  }
  if ((SADC_FTA as readonly string[]).includes(home)) {
    return `${home} is SADC FTA (Protocol on Trade 1996; FTA 2008), not a customs union. Empty harvest columns are intentional.`;
  }
  if ((COMESA_FTA as readonly string[]).includes(home)) {
    return `${home} is COMESA (FTA 2000; origin certificate). Ethiopia and Eritrea are not full FTA. Empty harvest columns are intentional.`;
  }
  if (home === "Algeria" || home === "Morocco") {
    return `${home} is AfCFTA-documentary. Land border with the other Maghreb neighbour has been closed since August 1994.`;
  }
  return `${home} is screened under AfCFTA origin rules only — no regional customs union CET on this desk. Empty harvest columns are intentional.`;
}

function blocSources(home: string): PublicationId[] {
  if ((AES as readonly string[]).includes(home)) return ["ecowasAesExit2025", "aesLevy2025", "afcftaOrigin"];
  if ((ECOWAS12 as readonly string[]).includes(home)) return ["ecowasCet2013", "etlsOrigin2003", "afcftaOrigin"];
  if ((SACU as readonly string[]).includes(home)) return ["sacuAgreement", "afcftaOrigin"];
  if ((EAC as readonly string[]).includes(home)) return ["eacCustoms", "afcftaOrigin"];
  if ((CEMAC as readonly string[]).includes(home)) return ["cemacUnion", "afcftaOrigin"];
  if ((SADC_FTA as readonly string[]).includes(home) && (COMESA_FTA as readonly string[]).includes(home)) {
    return ["sadcTrade1996", "comesaFta2000", "afcftaOrigin"];
  }
  if ((SADC_FTA as readonly string[]).includes(home)) return ["sadcTrade1996", "afcftaOrigin"];
  if ((COMESA_FTA as readonly string[]).includes(home)) return ["comesaFta2000", "afcftaOrigin"];
  if (home === "Algeria" || home === "Morocco") return ["algeriaMoroccoBorder", "afcftaOrigin"];
  return ["afcftaOrigin"];
}

function legalBrief(
  id: string,
  product: string,
  hsCode: string,
  headline: string,
  why: string,
  watch: string,
  measured: string,
  sources: PublicationId[],
  countries: string[],
): DeskBrief {
  return {
    id,
    stance: "avoid",
    product,
    hsCode,
    countries,
    months: ALL_YEAR,
    monthLabel: "all year without documents",
    headline,
    why,
    watch,
    sources: cite(...sources),
    measured,
    status: "official_print",
  };
}

function recBriefs(home: string): DeskBrief[] {
  const out: DeskBrief[] = [];
  out.push(
    legalBrief(
      "desk-complete",
      "Unsourced harvest calendars and modelled month windows",
      "00",
      `If you live in ${home}, this desk is complete without a made-up harvest calendar.`,
      `${home} is a live home on this product — one of 54. Buy and sell cards appear only when OECD/SWAC, IFPRI or an official HS print names the flow. Empty sourcing columns are the desk, not a missing country file.`,
      "Open a dated quote with a named counterparty. Do not fill months from a language model.",
      blocMeasured(home),
      blocSources(home),
      ["Any unsourced calendar"],
    ),
  );
  if ((ECOWAS12 as readonly string[]).includes(home)) {
    out.push(
      legalBrief(
        "etls-cet-35",
        "Sensitive food without origin proof",
        "07",
        `If you live in ${home}, do not move tomatoes, onions or other chapter-07 goods as if CET will be waived.`,
        "ECOWAS CET fifth band is 35% for specific goods for economic development. ETLS waives duty only for originating goods with the papers. A WhatsApp price is not a certificate.",
        "Ask for the origin document before you quote a delivered price. AES (Burkina Faso, Mali, Niger) left ECOWAS on 29 January 2025 — confirm this week’s treatment at the booth.",
        "CET bands: 0%, 5%, 10%, 20%, 35% (fifth band). ETLS: originating Community goods circulate without customs duties.",
        ["ecowasCet2013", "etlsOrigin2003", "ecowasAesExit2025"],
        ["Non-originating cargo"],
      ),
    );
  }
  if ((AES as readonly string[]).includes(home)) {
    out.push(
      legalBrief(
        "aes-ecowas-levy",
        "Goods to or from remaining ECOWAS members",
        "07",
        `If you live in ${home}, do not assume ECOWAS ETLS still prices the truck.`,
        "Burkina Faso, Mali and Niger withdrew from ECOWAS on 29 January 2025. ECOWAS said goods could still be treated under ETLS until further notice; AES then imposed a 0.5% levy on goods from ECOWAS members. Preference is a booth question this week, not a 2013 CET table.",
        "Carry origin papers anyway. UEMOA among the eight CFA members is a different instrument from ECOWAS ETLS.",
        "Withdrawal effective 29 January 2025. AES levy 0.5% on ECOWAS-origin imports (humanitarian aid excepted), reported March 2025.",
        ["ecowasAesExit2025", "aesLevy2025"],
        ["Ghana", "Nigeria", "Côte d’Ivoire", "Senegal"],
      ),
    );
  }
  if ((SACU as readonly string[]).includes(home)) {
    out.push(
      legalBrief(
        "sacu-cet",
        "Extra-SACU cargo priced as if it were free-circulating",
        "00",
        `If you live in ${home}, do not treat extra-SACU goods as duty-free inside the customs union.`,
        "SACU is a single customs territory: no customs duties among Botswana, Eswatini, Lesotho, Namibia and South Africa. Extra-SACU origin pays the common external tariff. A Walvis Bay or Durban landing is not SACU origin by itself.",
        "Origin documents still decide. Confirm HS6 with a broker.",
        "Five members; CET on non-members; internal customs duties eliminated on substantially all intra-SACU trade.",
        ["sacuAgreement"],
        ["Non-SACU origin"],
      ),
    );
  }
  if ((EAC as readonly string[]).includes(home)) {
    out.push(
      legalBrief(
        "eac-cet",
        "Extra-EAC cargo priced as if CET were zero",
        "00",
        `If you live in ${home}, do not assume East African Community CET is waived without origin proof.`,
        "The EAC Customs Union applies a common external tariff to extra-union goods. Preference is documentary.",
        "Confirm current CET band and partner-state practice at the OSBP. This desk has no sourced harvest calendar for this home beyond this legal screen.",
        "EAC Customs Union operational 2005; CET on extra-EAC origin.",
        ["eacCustoms"],
        ["Non-EAC origin"],
      ),
    );
  }
  if ((CEMAC as readonly string[]).includes(home)) {
    out.push(
      legalBrief(
        "cemac-cet",
        "Extra-CEMAC cargo priced as if CET were zero",
        "00",
        `If you live in ${home}, do not assume CEMAC CET is waived without origin proof.`,
        "CEMAC is a customs union of six members. Extra-union origin pays the common external tariff. A Douala warehouse is not Cameroonian origin by itself.",
        "This desk has no OECD-style perishable calendar for Central Africa. Empty seasonal columns are intentional.",
        "Six members; CET on extra-CEMAC goods.",
        ["cemacUnion"],
        ["Non-CEMAC origin"],
      ),
    );
  }
  if ((SADC_FTA as readonly string[]).includes(home)) {
    out.push(
      legalBrief(
        "sadc-fta",
        "Extra-SADC cargo priced as if the Protocol waived duty",
        "00",
        `If you live in ${home}, do not treat SADC as a customs union or extra-SADC origin as duty-free.`,
        "The SADC Protocol on Trade created a free trade area (launched August 2008), not a common external tariff. Preference is for originating SADC goods with the papers. Angola and others have lagged on some instruments — confirm this week’s treatment.",
        "Ask for the SADC origin document. SACU members use a CET among themselves; this home is not in that customs territory.",
        "Protocol on Trade signed 1996; FTA 2008. Origin still required. Extra-SADC goods pay national tariffs.",
        ["sadcTrade1996"],
        ["Non-SADC origin"],
      ),
    );
  }
  if ((COMESA_FTA as readonly string[]).includes(home)) {
    out.push(
      legalBrief(
        "comesa-fta",
        "Extra-COMESA cargo priced as if the FTA were a CET",
        "00",
        `If you live in ${home}, do not assume COMESA duty is zero without a certificate of origin.`,
        "COMESA is a free trade area (31 October 2000), not a customs union. As of April 2026, 16 members participate fully in the FTA; Ethiopia about 10% tariff reduction, Eritrea about 80%. Eswatini is under SACU derogation. A listing is not a COMESA certificate.",
        "Use the COMESA Trade Information Portal and a licensed broker. Overlap with SADC or AfCFTA does not stack automatically.",
        "FTA 2000; origin protocol annexed to the Treaty. Extra-COMESA origin pays national tariffs.",
        ["comesaFta2000"],
        ["Non-COMESA origin"],
      ),
    );
  }
  if (home === "Algeria" || home === "Morocco") {
    const other = home === "Algeria" ? "Morocco" : "Algeria";
    out.push(
      legalBrief(
        "dz-ma-land-closed",
        "Land freight to the closed Maghreb neighbour",
        "00",
        `If you live in ${home}, do not plan a land truck to ${other}.`,
        "Algeria closed the land border with Morocco in August 1994. It has remained closed. AfCFTA origin does not reopen a shut post.",
        "Sea and third-country routing are a different investigation. This brief is only the land border.",
        "Land border closed August 1994; still closed in 2023 public timelines.",
        ["algeriaMoroccoBorder"],
        [other],
      ),
    );
  }
  if (home === "Ghana") {
    out.push(
      legalBrief(
        "cocoa-licensed",
        "Cocoa beans",
        "1801",
        "If you live in Ghana, do not treat cocoa as a small-trader buy or sell into Togo or Côte d’Ivoire.",
        "Cocoa is marketed through the Ghana Cocoa Board. Unlicensed movement is a compliance failure, not a corridor.",
        "Licence, quality certificate, origin. If any one is missing, this is a no-go.",
        "Statutory COCOBOD export channel.",
        ["cocobod"],
        ["Togo", "Côte d’Ivoire"],
      ),
    );
  }
  out.push(
    legalBrief(
      "afcfta-papers",
      "Any goods claimed under AfCFTA preference",
      "00",
      `If you live in ${home}, do not quote AfCFTA duty as if a listing were a certificate of origin.`,
      "Preferential treatment under the AfCFTA requires proof of origin. A classifieds post is not that document.",
      "Confirm the HS code and the origin rule with a licensed broker before you treat duty as zero.",
      "AfCFTA preference is documentary.",
      ["afcftaOrigin"],
      ["Any claimed originating cargo"],
    ),
  );
  return out;
}

function fromCorridor(corridor: Corridor, role: Role): DeskBrief {
  return {
    id: `${corridor.id}-${role.home}-${role.stance}`,
    stance: role.stance,
    product: corridor.product,
    hsCode: corridor.hsCode,
    countries: role.countries,
    months: corridor.months,
    monthLabel: corridor.monthLabel,
    headline: role.headline,
    why: role.why,
    watch: corridor.watch,
    sources: cite(...corridor.sources),
    measured: corridor.measured,
    status: corridor.status,
    origin: role.origin,
    destination: role.destination,
  };
}

export function briefsFor(home: string): DeskBrief[] {
  const corridorBriefs = CORRIDORS.flatMap((corridor) =>
    corridor.roles.filter((role) => role.home === home).map((role) => fromCorridor(corridor, role)),
  );
  return [...corridorBriefs, ...recBriefs(home)].filter(isCompleteBrief);
}
