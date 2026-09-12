// TradeSafe Africa partner / investor pitch builder.
const fs = await import("node:fs/promises");
const path = await import("node:path");
const { Presentation, PresentationFile } = await import("@oai/artifact-tool");

const W = 1280;
const H = 720;

const DECK_ID = "tradesafe-pitch";
const OUT_DIR = "/Users/eddiebannerman-menson/Projects/africatradeopportunity-map/outputs/eeb9e668-8eeb-4d93-99ae-24ac3a6dd582";
const REF_DIR = "/Users/eddiebannerman-menson/Projects/africatradeopportunity-map/tmp/slides/pro-reference-images";
const SCRATCH_DIR = "/Users/eddiebannerman-menson/Projects/africatradeopportunity-map/tmp/slides/tradesafe-pitch";
const PREVIEW_DIR = path.join(SCRATCH_DIR, "preview");
const VERIFICATION_DIR = path.join(SCRATCH_DIR, "verification");
const INSPECT_PATH = path.join(SCRATCH_DIR, "inspect.ndjson");
const MAX_RENDER_VERIFY_LOOPS = 3;

const INK = "#14251D";
const GRAPHITE = "#2C3F36";
const MUTED = "#5C6B63";
const CREAM = "#F3F0E8";
const CREAM_96 = "#F3F0E8F2";
const FOREST = "#153D2D";
const FOREST_SOFT = "#153D2DCC";
const GOLD = "#E2AA48";
const GOLD_DARK = "#C4892E";
const WHITE = "#FFFFFF";
const TRANSPARENT = "#00000000";

const TITLE_FACE = "Caladea";
const BODY_FACE = "Lato";
const MONO_FACE = "Lato";

const FALLBACK_PLATE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const LIVE_URL = "https://africatradeopportunity-map.eddiebm.workers.dev";

const SOURCES = {
  afrexim: "Afreximbank, African Trade Report 2025: intra-African trade $220.3bn (2024); ~$100bn trade-finance gap.",
  gss: "Ghana Statistical Service ICBT survey (July 2026): GHS 31bn informal vs GHS 20.1bn formal with Togo, Burkina Faso, and Côte d’Ivoire, Q1–Q3 2025.",
  moti: "Ghana Ministry of Trade: official exports to Burkina Faso $637m in 2025.",
  product: "TradeSafe live alpha: matching, quotes, deal rooms, documents, disputes. Payments, licensed KYC, freight, and inspection are not live.",
};

const SLIDES = [
  {
    kicker: "Live alpha  ·  Ghana corridors",
    title: "TradeSafe Africa",
    subtitle: "The deal-file layer for intra-African SME trade.",
    moment: "Matching and quotes are live. We are not a bank.",
    notes: "Open on the product, not the dream. TradeSafe files the deal so a bank, insurer, or inspector can eventually underwrite it. Do not claim escrow or payments.",
    sources: ["product"],
  },
  {
    kicker: "The problem",
    title: "Trade still moves on\nWhatsApp and cash",
    subtitle: "Banks cannot underwrite what they cannot file.",
    notes: "Informal is not a side channel on Ghana’s neighbour lanes. The missing object is a deal file: HS, volume, Incoterms, KYC, inspection.",
    sources: ["gss", "afrexim"],
  },
  {
    kicker: "The product",
    title: "Atlas finds the lane.\nTradeSafe files the deal.",
    subtitle: "A classifieds marketplace with a dossier, not a storefront.",
    notes: "We are not Alibaba. The unit of value is a complete, shareable deal file.",
    sources: ["product"],
  },
  {
    kicker: "How it works",
    title: "One loop from listing\nto deal room",
    subtitle: "Every closed conversation should leave a file a partner can pick up.",
    notes: "Walk the five stations. Verification is admin today, licensed KYC later.",
    sources: ["product"],
  },
  {
    kicker: "Status",
    title: "What is live, and what\npartners still close",
    subtitle: "Copy must never imply that TradeSafe holds money or issues licenses.",
    notes: "Live: accounts, classifieds, admin verification, matching, quotes, deal rooms, documents, disputes. Remaining: licensed KYC, escrow, freight, inspection.",
    sources: ["product"],
  },
  {
    kicker: "The market",
    title: "Intra-African trade is large.\nThe file is still missing.",
    subtitle: "A continental finance gap sits next to growing corridor volumes.",
    notes: "220.3bn is intra-African merchandise trade 2024. The 100bn gap is trade finance, not a slice of the same pie.",
    sources: ["afrexim"],
  },
  {
    kicker: "Beachhead",
    title: "Start on Ghana’s\nneighbour lanes",
    subtitle: "Informal already outruns formal trade with Togo, Burkina Faso, and Côte d’Ivoire.",
    notes: "GSS ICBT is the beachhead proof. $637m official GH→BF is the formal floor, not the ceiling.",
    sources: ["gss", "moti"],
  },
  {
    kicker: "Revenue",
    title: "Earn on the closed file,\nnot on pretending to bank",
    subtitle: "Take rate on completed deals; licensed partners take money, trucks, and inspection.",
    notes: "$18k average is illustrative working capital, not a forecast. 1.5% is the starting take on the deal file.",
    sources: ["product"],
  },
  {
    kicker: "Scale cases",
    title: "Illustrative GMV at a\n$18k average deal",
    subtitle: "1.5% take on 50, 250, and 1,000 closed deals. Not a forecast.",
    notes: "50 × 18k = $0.9m GMV / $13.5k take. 250 → $4.5m / $67.5k. 1,000 → $18m / $270k.",
    sources: ["product"],
  },
  {
    kicker: "This quarter",
    title: "The partners who close\nmoney, trucks, and proof",
    subtitle: "TradeSafe originates the file. Specialists finish the corridor.",
    notes: "Week-1 outreach: Smile ID / Youverify, Flutterwave / Ecobank Ghana, Jetstream Africa, SGS / Intertek Ghana, ATIDI. Skip Kobo360/Sendy. PAPSS has no public API.",
    sources: ["product"],
  },
  {
    kicker: "Next conversation",
    title: "The alpha is live.\nCome walk a deal file.",
    subtitle: LIVE_URL,
    legal: "TradeSafe is a matching and deal-file product. It is not a bank, escrow agent, or licensed payment institution.",
    notes: "Close on a working URL and the legal line. Ask for an intro to a KYC provider and a corridor bank this quarter.",
    sources: ["product"],
  },
];

const inspectRecords = [];

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readImageBlob(imagePath) {
  const bytes = await fs.readFile(imagePath);
  if (!bytes.byteLength) {
    throw new Error(`Image file is empty: ${imagePath}`);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function normalizeImageConfig(config) {
  if (!config.path) {
    return config;
  }
  const { path: imagePath, ...rest } = config;
  return {
    ...rest,
    blob: await readImageBlob(imagePath),
  };
}

async function ensureDirs() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const obsoleteFinalArtifacts = [
    "preview",
    "verification",
    "inspect.ndjson",
    ["presentation", "proto.json"].join("_"),
    ["quality", "report.json"].join("_"),
  ];
  for (const obsolete of obsoleteFinalArtifacts) {
    await fs.rm(path.join(OUT_DIR, obsolete), { recursive: true, force: true });
  }
  await fs.mkdir(SCRATCH_DIR, { recursive: true });
  await fs.mkdir(PREVIEW_DIR, { recursive: true });
  await fs.mkdir(VERIFICATION_DIR, { recursive: true });
}

function lineConfig(fill = TRANSPARENT, width = 0) {
  return { style: "solid", fill, width };
}

function recordShape(slideNo, shape, role, shapeType, x, y, w, h) {
  if (!slideNo) return;
  inspectRecords.push({
    kind: "shape",
    slide: slideNo,
    id: shape?.id || `slide-${slideNo}-${role}-${inspectRecords.length + 1}`,
    role,
    shapeType,
    bbox: [x, y, w, h],
  });
}

function addShape(slide, geometry, x, y, w, h, fill = TRANSPARENT, line = TRANSPARENT, lineWidth = 0, meta = {}) {
  const shape = slide.shapes.add({
    geometry,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: lineConfig(line, lineWidth),
  });
  recordShape(meta.slideNo, shape, meta.role || geometry, geometry, x, y, w, h);
  return shape;
}

function normalizeText(text) {
  if (Array.isArray(text)) {
    return text.map((item) => String(item ?? "")).join("\n");
  }
  return String(text ?? "");
}

function textLineCount(text) {
  const value = normalizeText(text);
  if (!value.trim()) {
    return 0;
  }
  return Math.max(1, value.split(/\n/).length);
}

function requiredTextHeight(text, fontSize, lineHeight = 1.18, minHeight = 8) {
  const lines = textLineCount(text);
  if (lines === 0) {
    return minHeight;
  }
  return Math.max(minHeight, lines * fontSize * lineHeight);
}

function assertTextFits(text, boxHeight, fontSize, role = "text") {
  const required = requiredTextHeight(text, fontSize);
  const tolerance = Math.max(2, fontSize * 0.08);
  if (normalizeText(text).trim() && boxHeight + tolerance < required) {
    throw new Error(
      `${role} text box is too short: height=${boxHeight.toFixed(1)}, required>=${required.toFixed(1)}, ` +
        `lines=${textLineCount(text)}, fontSize=${fontSize}, text=${JSON.stringify(normalizeText(text).slice(0, 90))}`,
    );
  }
}

function wrapText(text, widthChars) {
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > widthChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.join("\n");
}

function recordText(slideNo, shape, role, text, x, y, w, h) {
  const value = normalizeText(text);
  inspectRecords.push({
    kind: "textbox",
    slide: slideNo,
    id: shape?.id || `slide-${slideNo}-${role}-${inspectRecords.length + 1}`,
    role,
    text: value,
    textPreview: value.replace(/\n/g, " | ").slice(0, 180),
    textChars: value.length,
    textLines: textLineCount(value),
    bbox: [x, y, w, h],
  });
}

function recordImage(slideNo, image, role, imagePath, x, y, w, h) {
  inspectRecords.push({
    kind: "image",
    slide: slideNo,
    id: image?.id || `slide-${slideNo}-${role}-${inspectRecords.length + 1}`,
    role,
    path: imagePath,
    bbox: [x, y, w, h],
  });
}

function applyTextStyle(box, text, size, color, bold, face, align, valign, autoFit, listStyle) {
  box.text = text;
  box.text.fontSize = size;
  box.text.color = color;
  box.text.bold = Boolean(bold);
  box.text.alignment = align;
  box.text.verticalAlignment = valign;
  box.text.typeface = face;
  box.text.insets = { left: 0, right: 0, top: 0, bottom: 0 };
  if (autoFit) {
    box.text.autoFit = autoFit;
  }
  if (listStyle) {
    box.text.style = "list";
  }
}

function addText(
  slide,
  slideNo,
  text,
  x,
  y,
  w,
  h,
  {
    size = 22,
    color = INK,
    bold = false,
    face = BODY_FACE,
    align = "left",
    valign = "top",
    fill = TRANSPARENT,
    line = TRANSPARENT,
    lineWidth = 0,
    autoFit = null,
    listStyle = false,
    checkFit = true,
    role = "text",
  } = {},
) {
  if (!checkFit && textLineCount(text) > 1) {
    throw new Error("checkFit=false is only allowed for single-line headers, footers, and captions.");
  }
  if (checkFit) {
    assertTextFits(text, h, size, role);
  }
  const box = addShape(slide, "rect", x, y, w, h, fill, line, lineWidth);
  applyTextStyle(box, text, size, color, bold, face, align, valign, autoFit, listStyle);
  recordText(slideNo, box, role, text, x, y, w, h);
  return box;
}

async function addImage(slide, slideNo, config, position, role, sourcePath = null) {
  const image = slide.images.add(await normalizeImageConfig(config));
  image.position = position;
  recordImage(slideNo, image, role, sourcePath || config.path || config.uri || "inline-data-url", position.left, position.top, position.width, position.height);
  return image;
}

async function addFullPlate(slide, slideNo) {
  slide.background.fill = CREAM;
  const platePath = path.join(REF_DIR, `slide-${String(slideNo).padStart(2, "0")}.png`);
  if (await pathExists(platePath)) {
    await addImage(
      slide,
      slideNo,
      { path: platePath, fit: "cover", alt: "Corridor atmosphere" },
      { left: 0, top: 0, width: W, height: H },
      "art plate",
      platePath,
    );
  } else {
    await addImage(
      slide,
      slideNo,
      { dataUrl: FALLBACK_PLATE_DATA_URL, fit: "cover", alt: "Fallback plate" },
      { left: 0, top: 0, width: W, height: H },
      "fallback art plate",
      "fallback-data-url",
    );
  }
}

async function addSidePlate(slide, slideNo, left = 742, top = 0, width = 538, height = 720) {
  slide.background.fill = CREAM;
  const platePath = path.join(REF_DIR, `slide-${String(slideNo).padStart(2, "0")}.png`);
  if (await pathExists(platePath)) {
    const image = await addImage(
      slide,
      slideNo,
      { path: platePath, fit: "cover", alt: "Corridor atmosphere" },
      { left, top, width, height },
      "side art plate",
      platePath,
    );
    image.geometry = "rect";
  }
}

function addHeader(slide, slideNo, kicker, idx, total) {
  addText(slide, slideNo, String(kicker || "").toUpperCase(), 64, 32, 720, 22, {
    size: 12,
    color: FOREST,
    bold: true,
    face: MONO_FACE,
    checkFit: false,
    role: "header",
  });
  addText(slide, slideNo, `${String(idx).padStart(2, "0")}  /  ${String(total).padStart(2, "0")}`, 980, 32, 236, 22, {
    size: 12,
    color: GOLD_DARK,
    bold: true,
    face: MONO_FACE,
    align: "right",
    checkFit: false,
    role: "header",
  });
  addShape(slide, "rect", 64, 58, 1152, 2, FOREST, TRANSPARENT, 0, { slideNo, role: "header rule" });
  addShape(slide, "rect", 64, 58, 72, 2, GOLD, TRANSPARENT, 0, { slideNo, role: "header gold mark" });
}

function addTitleBlock(slide, slideNo, title, subtitle = null, x = 64, y = 78, w = 700) {
  const titleH = Math.max(52, requiredTextHeight(title, 36) + 6);
  addText(slide, slideNo, title, x, y, w, titleH, {
    size: 36,
    color: INK,
    bold: true,
    face: TITLE_FACE,
    role: "title",
  });
  if (subtitle) {
    const subH = Math.max(44, requiredTextHeight(subtitle, 17) + 4);
    addText(slide, slideNo, subtitle, x, y + titleH + 6, Math.min(w, 680), subH, {
      size: 17,
      color: GRAPHITE,
      face: BODY_FACE,
      role: "subtitle",
    });
    return y + titleH + 6 + subH;
  }
  return y + titleH;
}

function addFooter(slide, slideNo, text) {
  addText(slide, slideNo, text, 64, 686, 1152, 20, {
    size: 11,
    color: MUTED,
    face: BODY_FACE,
    checkFit: false,
    role: "footer",
  });
}

function addNotes(slide, body, sourceKeys) {
  const sourceLines = (sourceKeys || []).map((key) => `- ${SOURCES[key] || key}`).join("\n");
  slide.speakerNotes.setText(`${body || ""}\n\n[Sources]\n${sourceLines}`);
}

function addContentCard(slide, slideNo, x, y, w, h, label, body, accent = GOLD) {
  addShape(slide, "roundRect", x, y, w, h, CREAM_96, FOREST, 1, { slideNo, role: `card panel: ${label}` });
  addShape(slide, "rect", x, y, 7, h, accent, TRANSPARENT, 0, { slideNo, role: `card accent: ${label}` });
  addText(slide, slideNo, label, x + 24, y + 18, w - 44, 28, {
    size: 15,
    color: FOREST,
    bold: true,
    face: TITLE_FACE,
    role: "card label",
  });
  const wrapped = wrapText(body, Math.max(22, Math.floor((w - 48) / 8.2)));
  addText(slide, slideNo, wrapped, x + 24, y + 52, w - 48, h - 70, {
    size: 15,
    color: INK,
    face: BODY_FACE,
    role: `card body: ${label}`,
  });
}

function styleAxis(axis) {
  if (!axis) return;
  axis.textStyle.typeface = BODY_FACE;
  axis.textStyle.fontSize = 12;
  axis.textStyle.fill = INK;
  axis.line = { style: "solid", fill: FOREST, width: 1.1 };
}

function styleChart(chart, { title = "", legend = "bottom", showTitle = true } = {}) {
  chart.title = showTitle ? title : "";
  chart.hasLegend = Boolean(legend);
  if (legend) {
    chart.legend.position = legend;
    chart.legend.textStyle.typeface = BODY_FACE;
    chart.legend.textStyle.fontSize = 13;
    chart.legend.textStyle.fill = INK;
  }
  chart.titleTextStyle.typeface = TITLE_FACE;
  chart.titleTextStyle.fontSize = 14;
  chart.titleTextStyle.fill = FOREST;
  chart.plotAreaFill = CREAM;
  styleAxis(chart.xAxis);
  styleAxis(chart.yAxis);
  if (chart.yAxis?.majorGridlines !== undefined) {
    chart.yAxis.majorGridlines = { style: "solid", fill: "#153D2D28", width: 0.8 };
  }
  chart.dataLabels.textStyle.typeface = BODY_FACE;
  chart.dataLabels.textStyle.fontSize = 12;
  chart.dataLabels.textStyle.fill = INK;
}

async function slideCover(presentation) {
  const slideNo = 1;
  const data = SLIDES[0];
  const slide = presentation.slides.add();
  await addFullPlate(slide, slideNo);
  addShape(slide, "rect", 0, 0, 720, H, "#F3F0E8E8", TRANSPARENT, 0, { slideNo, role: "cover cream panel" });
  addShape(slide, "rect", 64, 96, 8, 428, GOLD, TRANSPARENT, 0, { slideNo, role: "cover accent rule" });
  addText(slide, slideNo, data.kicker.toUpperCase(), 92, 96, 560, 24, {
    size: 13,
    color: FOREST,
    bold: true,
    face: MONO_FACE,
    role: "kicker",
  });
  addText(slide, slideNo, data.title, 88, 136, 600, 78, {
    size: 54,
    color: INK,
    bold: true,
    face: TITLE_FACE,
    role: "cover title",
  });
  addText(slide, slideNo, data.subtitle, 92, 228, 540, 56, {
    size: 20,
    color: GRAPHITE,
    face: BODY_FACE,
    role: "cover subtitle",
  });
  addShape(slide, "roundRect", 92, 320, 520, 96, FOREST, TRANSPARENT, 0, { slideNo, role: "cover moment panel" });
  addText(slide, slideNo, wrapText(data.moment, 42), 112, 338, 480, 62, {
    size: 18,
    color: CREAM,
    face: BODY_FACE,
    role: "cover moment",
  });
  addText(slide, slideNo, LIVE_URL, 92, 448, 560, 28, {
    size: 14,
    color: FOREST,
    face: BODY_FACE,
    role: "cover url",
  });
  addNotes(slide, data.notes, data.sources);
}

async function slideProblem(presentation) {
  const slideNo = 2;
  const data = SLIDES[1];
  const slide = presentation.slides.add();
  await addFullPlate(slide, slideNo);
  addShape(slide, "rect", 0, 0, 790, H, "#F3F0E8F0", TRANSPARENT, 0, { slideNo, role: "content panel" });
  addHeader(slide, slideNo, data.kicker, slideNo, SLIDES.length);
  addTitleBlock(slide, slideNo, data.title, data.subtitle, 64, 78, 680);
  const cards = [
    ["Informal majority", "Ghana’s ICBT with Togo, Burkina Faso, and Côte d’Ivoire ran GHS 31bn informal against GHS 20.1bn formal in Q1–Q3 2025."],
    ["No bank file", "HS codes, quantities, Incoterms, KYC, and inspection still live in chat threads and cash envelopes."],
    ["The $100bn gap", "Afreximbank puts the continental trade-finance gap near $100bn. Informal corridors cannot be underwritten as they stand."],
  ];
  for (let i = 0; i < cards.length; i += 1) {
    const [label, body] = cards[i];
    addContentCard(slide, slideNo, 64, 268 + i * 128, 690, 116, label, body, i === 1 ? FOREST : GOLD);
  }
  addFooter(slide, slideNo, "Sources: Ghana Statistical Service ICBT survey, July 2026; Afreximbank African Trade Report 2025.");
  addNotes(slide, data.notes, data.sources);
}

async function slideProduct(presentation) {
  const slideNo = 3;
  const data = SLIDES[2];
  const slide = presentation.slides.add();
  await addSidePlate(slide, slideNo);
  addHeader(slide, slideNo, data.kicker, slideNo, SLIDES.length);
  addTitleBlock(slide, slideNo, data.title, data.subtitle, 64, 78, 640);
  const cards = [
    ["Opportunity map", "Atlas shows corridor, HS heading, volume, and partner density before anyone opens a chat."],
    ["Match, then quote", "A buyer request meets a seller listing. The quote carries price, Incoterms, and lead time."],
    ["The deal room", "Documents, messages, and disputes attach to one record instead of a disappearing thread."],
  ];
  for (let i = 0; i < cards.length; i += 1) {
    const [label, body] = cards[i];
    addContentCard(slide, slideNo, 64, 268 + i * 128, 640, 116, label, body, i === 2 ? FOREST : GOLD);
  }
  addFooter(slide, slideNo, "TradeSafe is a deal-file layer, not a consumer marketplace and not a bank.");
  addNotes(slide, data.notes, data.sources);
}

async function slideLoop(presentation) {
  const slideNo = 4;
  const data = SLIDES[3];
  const slide = presentation.slides.add();
  await addFullPlate(slide, slideNo);
  addShape(slide, "rect", 0, 0, W, H, "#F3F0E8EB", TRANSPARENT, 0, { slideNo, role: "content overlay" });
  addHeader(slide, slideNo, data.kicker, slideNo, SLIDES.length);
  addTitleBlock(slide, slideNo, data.title, data.subtitle, 64, 78, 900);
  const steps = [
    ["01", "List", "Buyer request or seller listing with HS, origin, and volume."],
    ["02", "Verify", "Admin reviews the organisation before it can trade."],
    ["03", "Match", "Corridor, product, and quantity score the other side."],
    ["04", "Quote", "Sellers answer with price, Incoterms, and lead time."],
    ["05", "Deal room", "Documents, messages, and disputes sit on one file."],
  ];
  const cardW = 204;
  const gap = 16;
  const startX = 64;
  for (let i = 0; i < steps.length; i += 1) {
    const [num, label, body] = steps[i];
    const x = startX + i * (cardW + gap);
    addShape(slide, "roundRect", x, 278, cardW, 332, CREAM, FOREST, 1, { slideNo, role: `step panel: ${label}` });
    addShape(slide, "ellipse", x + 22, 302, 46, 46, FOREST, TRANSPARENT, 0, { slideNo, role: "step badge" });
    addText(slide, slideNo, num, x + 22, 312, 46, 28, {
      size: 14,
      color: CREAM,
      bold: true,
      face: MONO_FACE,
      align: "center",
      role: "step number",
    });
    addText(slide, slideNo, label, x + 20, 362, cardW - 40, 36, {
      size: 20,
      color: INK,
      bold: true,
      face: TITLE_FACE,
      role: "step label",
    });
    addText(slide, slideNo, wrapText(body, 18), x + 20, 410, cardW - 40, 170, {
      size: 15,
      color: GRAPHITE,
      face: BODY_FACE,
      role: "step body",
    });
    if (i < steps.length - 1) {
      addShape(slide, "rect", x + cardW - 2, 430, gap + 4, 3, GOLD, TRANSPARENT, 0, { slideNo, role: "step connector" });
    }
  }
  addFooter(slide, slideNo, "Verification is an admin review in the alpha. Licensed KYC is a partner step, not a live product claim.");
  addNotes(slide, data.notes, data.sources);
}

async function slideLive(presentation) {
  const slideNo = 5;
  const data = SLIDES[4];
  const slide = presentation.slides.add();
  await addFullPlate(slide, slideNo);
  addShape(slide, "rect", 0, 0, W, H, "#F3F0E8E6", TRANSPARENT, 0, { slideNo, role: "content overlay" });
  addHeader(slide, slideNo, data.kicker, slideNo, SLIDES.length);
  addTitleBlock(slide, slideNo, data.title, data.subtitle, 64, 78, 980);
  addShape(slide, "roundRect", 64, 268, 552, 380, CREAM, FOREST, 1, { slideNo, role: "live panel" });
  addShape(slide, "rect", 64, 268, 552, 8, GOLD, TRANSPARENT, 0, { slideNo, role: "live accent" });
  addText(slide, slideNo, "Live in the alpha", 88, 292, 500, 36, {
    size: 22,
    color: FOREST,
    bold: true,
    face: TITLE_FACE,
    role: "live heading",
  });
  addText(
    slide,
    slideNo,
    wrapText("Accounts, classifieds, admin verification, matching, quotes, deal rooms, documents, and disputes.", 42),
    88,
    340,
    500,
    90,
    { size: 16, color: INK, face: BODY_FACE, role: "live body" },
  );
  addText(
    slide,
    slideNo,
    wrapText("A trader can list, get matched, receive a quote, and keep the paper on one record today.", 42),
    88,
    440,
    500,
    90,
    { size: 16, color: GRAPHITE, face: BODY_FACE, role: "live detail" },
  );

  addShape(slide, "roundRect", 664, 268, 552, 380, FOREST, TRANSPARENT, 0, { slideNo, role: "remaining panel" });
  addShape(slide, "rect", 664, 268, 552, 8, GOLD, TRANSPARENT, 0, { slideNo, role: "remaining accent" });
  addText(slide, slideNo, "Partners still close", 688, 292, 500, 36, {
    size: 22,
    color: CREAM,
    bold: true,
    face: TITLE_FACE,
    role: "remaining heading",
  });
  addText(
    slide,
    slideNo,
    wrapText("Licensed KYC, escrow and payments, freight booking, and inspection are not live and will not be claimed as product.", 40),
    688,
    340,
    500,
    110,
    { size: 16, color: CREAM, face: BODY_FACE, role: "remaining body" },
  );
  addText(
    slide,
    slideNo,
    wrapText("Those seats belong to KYC vendors, banks, PSPs, freight, and inspection houses.", 40),
    688,
    460,
    500,
    90,
    { size: 16, color: "#E8D9B0", face: BODY_FACE, role: "remaining detail" },
  );
  addFooter(slide, slideNo, "TradeSafe does not hold client funds and is not a licensed payment institution.");
  addNotes(slide, data.notes, data.sources);
}

async function slideMarket(presentation) {
  const slideNo = 6;
  const data = SLIDES[5];
  const slide = presentation.slides.add();
  await addFullPlate(slide, slideNo);
  addShape(slide, "rect", 0, 0, W, H, "#F3F0E8EE", TRANSPARENT, 0, { slideNo, role: "content overlay" });
  addHeader(slide, slideNo, data.kicker, slideNo, SLIDES.length);
  addTitleBlock(slide, slideNo, data.title, data.subtitle, 64, 78, 720);

  addShape(slide, "roundRect", 64, 268, 268, 168, CREAM, FOREST, 1, { slideNo, role: "metric 220" });
  addText(slide, slideNo, "$220.3bn", 84, 288, 228, 54, {
    size: 32,
    color: FOREST,
    bold: true,
    face: TITLE_FACE,
    role: "metric value",
  });
  addText(slide, slideNo, wrapText("Intra-African merchandise trade, 2024.", 22), 84, 348, 228, 64, {
    size: 14,
    color: GRAPHITE,
    face: BODY_FACE,
    role: "metric label",
  });

  addShape(slide, "roundRect", 64, 456, 268, 168, FOREST, TRANSPARENT, 0, { slideNo, role: "metric 100" });
  addText(slide, slideNo, "~$100bn", 84, 476, 228, 54, {
    size: 32,
    color: GOLD,
    bold: true,
    face: TITLE_FACE,
    role: "metric value",
  });
  addText(slide, slideNo, wrapText("Estimated trade-finance gap across the continent.", 22), 84, 536, 228, 64, {
    size: 14,
    color: CREAM,
    face: BODY_FACE,
    role: "metric label",
  });

  addShape(slide, "roundRect", 360, 268, 856, 356, CREAM, FOREST, 1, { slideNo, role: "market chart panel" });
  const chart = slide.charts.add("bar");
  chart.position = { left: 384, top: 292, width: 808, height: 308 };
  chart.barOptions.direction = "column";
  chart.barOptions.grouping = "clustered";
  chart.categories = ["Intra-African trade, 2024", "Trade-finance gap"];
  const series = chart.series.add("USD billions");
  series.values = [220.3, 100];
  series.categories = chart.categories;
  series.fill = FOREST;
  series.stroke = { width: 0, style: "solid", fill: FOREST };
  styleChart(chart, { title: "USD billions", legend: "bottom" });
  chart.dataLabels.showValue = true;
  chart.dataLabels.position = "outEnd";
  chart.yAxis.majorGridlines = { style: "solid", fill: "#153D2D24", width: 0.8 };

  addFooter(slide, slideNo, "Source: Afreximbank, African Trade Report 2025. The gap is trade finance, not a slice of the $220.3bn.");
  addNotes(slide, data.notes, data.sources);
}

async function slideBeachhead(presentation) {
  const slideNo = 7;
  const data = SLIDES[6];
  const slide = presentation.slides.add();
  await addFullPlate(slide, slideNo);
  addShape(slide, "rect", 0, 0, W, H, "#F3F0E8EE", TRANSPARENT, 0, { slideNo, role: "content overlay" });
  addHeader(slide, slideNo, data.kicker, slideNo, SLIDES.length);
  addTitleBlock(slide, slideNo, data.title, data.subtitle, 64, 78, 640);

  addShape(slide, "roundRect", 64, 268, 360, 356, CREAM, FOREST, 1, { slideNo, role: "beachhead callout" });
  addText(slide, slideNo, "$637m", 88, 296, 312, 54, {
    size: 36,
    color: FOREST,
    bold: true,
    face: TITLE_FACE,
    role: "metric value",
  });
  addText(
    slide,
    slideNo,
    wrapText("Official Ghana exports to Burkina Faso in 2025 — the formal floor on one Sahel lane, not the informal ceiling.", 28),
    88,
    362,
    312,
    140,
    { size: 16, color: INK, face: BODY_FACE, role: "beachhead body" },
  );
  addText(slide, slideNo, wrapText("Ministry of Trade, 2025.", 28), 88, 530, 312, 48, {
    size: 13,
    color: MUTED,
    face: BODY_FACE,
    role: "beachhead source",
  });

  addShape(slide, "roundRect", 452, 268, 764, 356, CREAM, FOREST, 1, { slideNo, role: "icbt chart panel" });
  const chart = slide.charts.add("pie");
  chart.position = { left: 472, top: 288, width: 724, height: 316 };
  chart.categories = ["Informal ICBT (GHS 31bn)", "Formal (GHS 20.1bn)"];
  const series = chart.series.add("GHS billions, Q1–Q3 2025");
  series.values = [31, 20.1];
  series.categories = chart.categories;
  series.fill = FOREST;
  styleChart(chart, { title: "Ghana trade with Togo, Burkina Faso, Côte d’Ivoire", legend: "bottom" });
  chart.dataLabels.showValue = true;
  chart.dataLabels.position = "outEnd";

  addFooter(slide, slideNo, "Source: Ghana Statistical Service ICBT survey, July 2026, Q1–Q3 2025 neighbour trade.");
  addNotes(slide, data.notes, data.sources);
}

async function slideRevenue(presentation) {
  const slideNo = 8;
  const data = SLIDES[7];
  const slide = presentation.slides.add();
  await addFullPlate(slide, slideNo);
  addShape(slide, "rect", 0, 0, W, H, "#F3F0E8EB", TRANSPARENT, 0, { slideNo, role: "content overlay" });
  addHeader(slide, slideNo, data.kicker, slideNo, SLIDES.length);
  addTitleBlock(slide, slideNo, data.title, data.subtitle, 64, 78, 980);
  const cards = [
    ["1.5% on the file", "Starting take on a closed deal record — matching, quote, and documents — not on holding funds."],
    ["$18k working average", "Illustrative SME lot size used for scale cases. Corridor lots will vary; this is not a forecast."],
    ["Partners take the rest", "KYC, escrow, freight, and inspection fees belong to licensed specialists. Referral economics come after those seats are filled."],
  ];
  const cardW = 368;
  for (let i = 0; i < cards.length; i += 1) {
    const [label, body] = cards[i];
    addContentCard(slide, slideNo, 64 + i * (cardW + 24), 278, cardW, 340, label, body, i === 0 ? GOLD : FOREST);
  }
  addFooter(slide, slideNo, "Illustrative unit economics for planning. Not a revenue forecast.");
  addNotes(slide, data.notes, data.sources);
}

async function slideScale(presentation) {
  const slideNo = 9;
  const data = SLIDES[8];
  const slide = presentation.slides.add();
  await addFullPlate(slide, slideNo);
  addShape(slide, "rect", 0, 0, W, H, "#F3F0E8EE", TRANSPARENT, 0, { slideNo, role: "content overlay" });
  addHeader(slide, slideNo, data.kicker, slideNo, SLIDES.length);
  addTitleBlock(slide, slideNo, data.title, data.subtitle, 64, 78, 900);

  const takes = [
    ["50 deals", "$13.5k take"],
    ["250 deals", "$67.5k take"],
    ["1,000 deals", "$270k take"],
  ];
  for (let i = 0; i < takes.length; i += 1) {
    const [label, value] = takes[i];
    const x = 64 + i * 384;
    addShape(slide, "roundRect", x, 248, 360, 64, CREAM, FOREST, 1, { slideNo, role: `take pill: ${label}` });
    addText(slide, slideNo, `${label}  ·  ${value}`, x + 16, 264, 328, 32, {
      size: 16,
      color: FOREST,
      bold: true,
      face: BODY_FACE,
      align: "center",
      role: "take label",
    });
  }

  addShape(slide, "roundRect", 64, 328, 1152, 326, CREAM, FOREST, 1, { slideNo, role: "gmv chart panel" });
  const chart = slide.charts.add("bar");
  chart.position = { left: 96, top: 340, width: 1088, height: 292 };
  chart.barOptions.direction = "column";
  chart.barOptions.grouping = "clustered";
  chart.categories = ["50 deals", "250 deals", "1,000 deals"];
  const gmv = chart.series.add("GMV ($ millions)");
  gmv.values = [0.9, 4.5, 18];
  gmv.categories = chart.categories;
  gmv.fill = FOREST;
  gmv.stroke = { width: 0, style: "solid", fill: FOREST };
  styleChart(chart, { title: "Illustrative GMV, $ millions", legend: "bottom" });
  chart.dataLabels.showValue = true;
  chart.dataLabels.position = "outEnd";
  chart.yAxis.majorGridlines = { style: "solid", fill: "#153D2D24", width: 0.8 };

  addFooter(slide, slideNo, "Working cases only: 50 × $18k = $0.9m GMV; 250 = $4.5m; 1,000 = $18m. Not a forecast.");
  addNotes(slide, data.notes, data.sources);
}

async function slidePartners(presentation) {
  const slideNo = 10;
  const data = SLIDES[9];
  const slide = presentation.slides.add();
  await addFullPlate(slide, slideNo);
  addShape(slide, "rect", 0, 0, W, H, "#F3F0E8EB", TRANSPARENT, 0, { slideNo, role: "content overlay" });
  addHeader(slide, slideNo, data.kicker, slideNo, SLIDES.length);
  addTitleBlock(slide, slideNo, data.title, data.subtitle, 64, 78, 980);
  const cards = [
    ["Identity", "Licensed KYC for Ghana and ECOWAS entities. First conversations: Smile ID and Youverify."],
    ["Money", "Escrow and corridor settlement through a bank or PSP. First conversations: Flutterwave and Ecobank Ghana."],
    ["Trucks", "Documented freight on Accra–Sahel lanes. First conversation: Jetstream Africa."],
    ["Proof", "Inspection and political-risk cover on the file. SGS Ghana, Intertek Ghana, ATIDI."],
  ];
  const cardW = 560;
  const cardH = 168;
  for (let i = 0; i < cards.length; i += 1) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const [label, body] = cards[i];
    addContentCard(slide, slideNo, 64 + col * (cardW + 24), 258 + row * (cardH + 20), cardW, cardH, label, body, col === 0 ? GOLD : FOREST);
  }
  addFooter(slide, slideNo, "Ask this quarter: an intro to a KYC provider and a corridor bank. PAPSS has no public API.");
  addNotes(slide, data.notes, data.sources);
}

async function slideClose(presentation) {
  const slideNo = 11;
  const data = SLIDES[10];
  const slide = presentation.slides.add();
  await addFullPlate(slide, slideNo);
  addShape(slide, "rect", 0, 0, W, H, "#14251DE6", TRANSPARENT, 0, { slideNo, role: "close overlay" });
  addText(slide, slideNo, data.kicker.toUpperCase(), 64, 88, 720, 24, {
    size: 13,
    color: GOLD,
    bold: true,
    face: MONO_FACE,
    role: "kicker",
  });
  addText(slide, slideNo, data.title, 64, 130, 980, 140, {
    size: 40,
    color: CREAM,
    bold: true,
    face: TITLE_FACE,
    role: "close title",
  });
  addShape(slide, "roundRect", 64, 300, 900, 72, GOLD, TRANSPARENT, 0, { slideNo, role: "url panel" });
  addText(slide, slideNo, data.subtitle, 84, 318, 860, 36, {
    size: 18,
    color: FOREST,
    bold: true,
    face: BODY_FACE,
    role: "close url",
  });
  addText(slide, slideNo, wrapText(data.legal, 88), 64, 404, 980, 72, {
    size: 16,
    color: "#E8D9B0",
    face: BODY_FACE,
    role: "legal line",
  });
  addText(slide, slideNo, "Ask: intro to a KYC provider and a corridor bank this quarter.", 64, 500, 900, 36, {
    size: 18,
    color: CREAM,
    face: BODY_FACE,
    role: "close ask",
  });
  addNotes(slide, data.notes, data.sources);
}

async function createDeck() {
  await ensureDirs();
  if (!SLIDES.length) {
    throw new Error("SLIDES must contain at least one slide.");
  }
  const presentation = Presentation.create({ slideSize: { width: W, height: H } });
  await slideCover(presentation);
  await slideProblem(presentation);
  await slideProduct(presentation);
  await slideLoop(presentation);
  await slideLive(presentation);
  await slideMarket(presentation);
  await slideBeachhead(presentation);
  await slideRevenue(presentation);
  await slideScale(presentation);
  await slidePartners(presentation);
  await slideClose(presentation);
  return presentation;
}

async function saveBlobToFile(blob, filePath) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await fs.writeFile(filePath, bytes);
}

async function writeInspectArtifact(presentation) {
  inspectRecords.unshift({
    kind: "deck",
    id: DECK_ID,
    slideCount: presentation.slides.count,
    slideSize: { width: W, height: H },
  });
  presentation.slides.items.forEach((slide, index) => {
    inspectRecords.splice(index + 1, 0, {
      kind: "slide",
      slide: index + 1,
      id: slide?.id || `slide-${index + 1}`,
    });
  });
  const lines = inspectRecords.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await fs.writeFile(INSPECT_PATH, lines, "utf8");
}

async function currentRenderLoopCount() {
  const logPath = path.join(VERIFICATION_DIR, "render_verify_loops.ndjson");
  if (!(await pathExists(logPath))) return 0;
  const previous = await fs.readFile(logPath, "utf8");
  return previous.split(/\r?\n/).filter((line) => line.trim()).length;
}

async function nextRenderLoopNumber() {
  return (await currentRenderLoopCount()) + 1;
}

async function appendRenderVerifyLoop(presentation, previewPaths, pptxPath) {
  const logPath = path.join(VERIFICATION_DIR, "render_verify_loops.ndjson");
  const priorCount = await currentRenderLoopCount();
  const record = {
    kind: "render_verify_loop",
    deckId: DECK_ID,
    loop: priorCount + 1,
    maxLoops: MAX_RENDER_VERIFY_LOOPS,
    capReached: priorCount + 1 >= MAX_RENDER_VERIFY_LOOPS,
    timestamp: new Date().toISOString(),
    slideCount: presentation.slides.count,
    previewCount: previewPaths.length,
    previewDir: PREVIEW_DIR,
    inspectPath: INSPECT_PATH,
    pptxPath,
  };
  await fs.appendFile(logPath, JSON.stringify(record) + "\n", "utf8");
  return record;
}

async function verifyAndExport(presentation) {
  await ensureDirs();
  const nextLoop = await nextRenderLoopNumber();
  if (nextLoop > MAX_RENDER_VERIFY_LOOPS) {
    throw new Error(
      `Render/verify/fix loop cap reached: ${MAX_RENDER_VERIFY_LOOPS} total renders are allowed. ` +
        "Do not rerender; note any remaining visual issues in the final response.",
    );
  }
  await writeInspectArtifact(presentation);
  const previewPaths = [];
  for (let idx = 0; idx < presentation.slides.items.length; idx += 1) {
    const slide = presentation.slides.items[idx];
    const preview = await presentation.export({ slide, format: "png", scale: 1 });
    const previewPath = path.join(PREVIEW_DIR, `slide-${String(idx + 1).padStart(2, "0")}.png`);
    await saveBlobToFile(preview, previewPath);
    previewPaths.push(previewPath);
  }
  const pptxBlob = await PresentationFile.exportPptx(presentation);
  const pptxPath = path.join(OUT_DIR, "output.pptx");
  await pptxBlob.save(pptxPath);
  const loopRecord = await appendRenderVerifyLoop(presentation, previewPaths, pptxPath);
  return { pptxPath, loopRecord };
}

const presentation = await createDeck();
const result = await verifyAndExport(presentation);
console.log(result.pptxPath);
