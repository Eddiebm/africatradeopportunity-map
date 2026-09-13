export default function Built() {
  return (
    <main className="built">
      <header>
        <div className="brand">
          <i>TS</i>
          <span>
            <b>TradeSafe Africa</b>
            <small>Product status</small>
          </span>
        </div>
        <nav>
          <a href="/">Atlas</a>
          <a href="/marketplace">Marketplace</a>
          <a href="/dashboard">My deals</a>
        </nav>
      </header>
      <section className="answerPage">
        <p>STRAIGHT ANSWERS</p>
        <h1>Can strangers transact here?</h1>
        <div className="shortAnswer noAnswer">
          <b>No.</b>
          <span>
            Research and deal-prep tools are live at{" "}
            <strong>tradesafe-africa.eddiebm.workers.dev</strong>. The product cannot yet hold
            licensed money, run real KYC, or complete a verified shipment.
          </span>
        </div>
        <div className="answerGrid">
          <article>
            <b>WORKING NOW</b>
            <p>
              Source is on GitHub at Eddiebm/africatradeopportunity-map. Accounts, sessions,
              Turnstile, D1, and R2 are on the live Worker. You can open a desk after register or
              sign-in.
            </p>
          </article>
          <article>
            <b>NOT WORKING YET</b>
            <p>
              Outbound email is not connected (<code>RESEND_API_KEY</code> unset), so verification
              and password-reset messages are logged, not sent. There is no custom domain, no
              licensed payment rail, and no identity-verification provider.
            </p>
          </article>
          <article>
            <b>WHAT IS NEXT</b>
            <p>
              Connect Resend (GitHub secret <code>RESEND_API_KEY</code>), then a real domain, then
              one operated corridor with licensed money and real KYC. Do not treat a green CI run as
              a finished public trade product.
            </p>
          </article>
        </div>
        <aside>
          <b>Is the GitHub repo public under eddiebm?</b>
          <p>
            Yes — <a href="https://github.com/Eddiebm/africatradeopportunity-map">Eddiebm/africatradeopportunity-map</a>.
            An older status note that said the code had not been pushed is wrong.
          </p>
        </aside>
        <a className="primaryLink" href="/register">
          Open a trade desk →
        </a>
      </section>
      <footer>
        <b>TradeSafe Africa</b>
        <span>Status describes the deployed Worker, not a regulated marketplace.</span>
      </footer>
    </main>
  );
}
