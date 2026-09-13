import { emailDeliveryLive } from "../../lib/email";
import type { SessionUser } from "../../lib/auth/current-user";
import { ResendVerificationButton } from "./ResendVerificationButton";

export function EmailUnverifiedNote({ user }: { user: SessionUser }) {
  if (user.emailVerifiedAt) return null;
  const mailLive = emailDeliveryLive();
  return (
    <section className="resolutionnote">
      <b>Email is not verified.</b>
      {mailLive ? (
        <p>
          If outbound mail is working, a verification link was sent to {user.email}. Password reset
          also uses that path.
        </p>
      ) : (
        <p>
          No verification message was sent. Outbound mail is not connected on this Worker
          (<code>RESEND_API_KEY</code> is unset), so inbox delivery cannot happen yet. You can still
          use the desk. Password reset will also not arrive until mail is connected.
        </p>
      )}
      <ResendVerificationButton />
    </section>
  );
}
