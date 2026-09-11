// Priority 4 (docs/production-readiness.md): "Prepare for localization by
// ... adding locale-aware currency ... numbers and dates ... supporting
// time zones correctly ... keeping English as the initial complete
// language ... structuring the system for later French support."
//
// SCOPE, stated honestly: this is the FORMATTING layer, not full i18n.
// It replaces ad-hoc `${currency} ${amount.toLocaleString()}` string
// concatenation (found across app/page.tsx, app/deal/[id]/page.tsx,
// app/disputes/page.tsx, app/disputes/[id]/page.tsx, app/admin/page.tsx)
// with real Intl-based formatting that takes an explicit locale rather
// than silently depending on the server's or browser's ambient default
// (the two can disagree, which is exactly the kind of SSR/hydration
// mismatch this app already had one serious bug from this session — see
// the CSP/hydration fix earlier in this branch's history — so an
// explicit locale argument here is deliberate, not decorative).
//
// What this does NOT do: extract the ~30 pages' inline JSX copy into
// translation keys. That is a separate, much larger effort (every
// hardcoded English string in every page becomes a lookup) that this
// pass does not attempt — doing it hastily across the whole app in one
// pass would be a high-risk rewrite with no way to verify every string
// was moved correctly. DEFAULT_LOCALE below is the seam that later work
// hangs off: once real string extraction happens, this is where a
// request-derived locale (e.g. from an Accept-Language header or a user
// preference) would replace the hardcoded default.
export const SUPPORTED_LOCALES = ["en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";

// BCP 47 locale tags Intl actually wants — "en" maps to "en-US" here
// deliberately (not "en-GB" or a bare "en") to match this app's existing
// currency-formatting conventions (USD as the primary reference
// currency throughout deals/quotes) until a real per-country locale
// mapping is built.
const INTL_LOCALE: Record<SupportedLocale, string> = { en: "en-US" };

export function formatCurrency(amount: number, currency: string, locale: SupportedLocale = DEFAULT_LOCALE): string {
  try {
    return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    // An unrecognized ISO 4217 code (shouldn't happen — currency values
    // in this app come from a fixed select list, see
    // app/deal/[id]/page.tsx's QuoteRequestForm — but Intl throws on a
    // truly invalid code, and a landed-cost figure must never just
    // disappear because of a formatting error) falls back to a plain
    // number with the code as a prefix, never a blank/crashed render.
    return `${currency} ${formatNumber(amount, locale)}`;
  }
}

export function formatNumber(value: number, locale: SupportedLocale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(value);
}

// `timeZone: "UTC"` is deliberate, not an oversight: every timestamp
// stored by this app (see db/schema.ts's `sql`CURRENT_TIMESTAMP`` default
// and every `new Date().toISOString()` call site) is UTC, and there is no
// per-user timezone preference stored anywhere yet — displaying it in the
// *server's* local timezone (which is what an omitted timeZone option
// would do, and which is meaningless for a Cloudflare Worker with no
// fixed physical location anyway) would be actively misleading. This is
// the honest default until a real per-user timezone preference exists.
export function formatDateTime(iso: string, locale: SupportedLocale = DEFAULT_LOCALE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}
