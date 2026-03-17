export default function Privacy() {
  return (
    <>
      <a href="/" className="nav-logo">
        <img src="/icon.png" alt="Clasp-it logo" />
        Clasp-it
      </a>
      <main className="privacy-content">
        <h1>Privacy Policy</h1>
        <p className="last-updated">Last updated: March 2026</p>

        <section>
          <h2>What we collect</h2>
          <p>When you sign up, we collect your <strong>email address</strong> to create your account and send you a magic link for authentication.</p>
          <p>When you use the extension to pick an element, we collect the <strong>element context</strong> you explicitly capture — HTML, CSS selector, computed styles, and optionally a screenshot, console logs, network requests, and React props (Pro plan). This data is sent to our server so your AI editor can read it via MCP.</p>
          <p>Your <strong>API key</strong> is stored locally in your browser (chrome.storage.local) and transmitted to our server to authenticate requests.</p>
        </section>

        <section>
          <h2>How we use it</h2>
          <p>Your email is used only for account creation, authentication, and transactional emails (magic links, API key delivery). We do not send marketing emails.</p>
          <p>Element context is stored temporarily on our servers so Claude Code can retrieve it. It is automatically deleted after 24 hours. Screenshots are sent in the POST request and are never written to disk on our servers.</p>
        </section>

        <section>
          <h2>Data retention</h2>
          <p>Pick context (HTML, CSS, your prompt) is stored in Redis with a 24-hour TTL and deleted automatically. Your email and plan status are stored in our database for as long as you have an account. You can request deletion at any time by emailing us.</p>
        </section>

        <section>
          <h2>Third parties</h2>
          <p>We use the following services to operate Clasp-it:</p>
          <ul>
            <li><strong>Neon</strong> — Postgres database (stores email, plan, API key hash)</li>
            <li><strong>Upstash</strong> — Redis (stores pick context, TTL 24h)</li>
            <li><strong>Resend</strong> — transactional email delivery</li>
            <li><strong>Dodo Payments</strong> — payment processing for Pro plan</li>
            <li><strong>Railway</strong> — server hosting</li>
          </ul>
          <p>We do not sell or share your data with any other third parties.</p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>Questions or deletion requests: <a href="mailto:dev@madhans.world">dev@madhans.world</a></p>
        </section>
      </main>
    </>
  );
}
