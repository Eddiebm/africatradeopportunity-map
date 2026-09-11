import { requireUser } from "../../lib/auth/current-user";
import SignOutLink from "../components/SignOutLink";
import AccountDeletionPanel from "../components/AccountDeletionPanel";

export const dynamic = "force-dynamic";

// Production-hardening audit follow-up (docs/production-readiness.md): "no
// account-deletion flow" — this is the self-service entry point. See
// lib/account-deletion.ts's header comment for the full design (request,
// not instant; held for review if a deal/dispute/exception is open;
// anonymize, not hard-delete).
export default async function Account() {
  const user = await requireUser("/account");
  return (
    <main className="portal">
      <header>
        <div className="brand"><i>TS</i><span><b>TradeSafe Africa</b><small>Account</small></span></div>
        <nav><a href="/dashboard">My deals</a><a href="/organizations">My organizations</a><SignOutLink /></nav>
      </header>
      <section className="portalhead">
        <div><p>ACCOUNT SETTINGS</p><h1>{user.displayName || user.email}</h1></div>
      </section>
      <AccountDeletionPanel />
    </main>
  );
}
