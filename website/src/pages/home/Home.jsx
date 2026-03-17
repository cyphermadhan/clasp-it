import { useState, useEffect, useCallback } from 'react';
import observe from '../../analytics.js';

export default function Home() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [signupState, setSignupState] = useState('idle'); // idle | loading | success | error

  const openDemo = () => { observe.track('demo_opened'); setDemoOpen(true); };
  const closeDemo = () => setDemoOpen(false);

  useEffect(() => {
    if (window.location.hash === '#pricing') {
      document.querySelector('.pricing')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeDemo(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = demoOpen ? 'hidden' : '';
  }, [demoOpen]);

  const handleSignup = useCallback(async () => {
    if (!email || !email.includes('@')) {
      setSignupState('error');
      setTimeout(() => setSignupState('idle'), 1800);
      return;
    }
    setSignupState('loading');
    try {
      const res = await fetch('/beta/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        observe.track('beta_signup_submitted', { email });
        setSignupState('success');
      } else {
        setSignupState('error');
        setTimeout(() => setSignupState('idle'), 1800);
      }
    } catch {
      setSignupState('idle');
    }
  }, [email]);

  return (
    <>
      {/* Demo Modal */}
      <div
        className={`demo-overlay${demoOpen ? ' open' : ''}`}
        onClick={(e) => { if (e.target === e.currentTarget) closeDemo(); }}
      >
        <div className="demo-modal">
          <button className="demo-close" onClick={closeDemo} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
          <iframe
            src="https://www.loom.com/embed/c57056eebd6c440696274bccc6730ffd"
            allowFullScreen
          />
        </div>
      </div>

      {/* Nav */}
      <nav>
        <a href="/" className="nav-logo">
          <img src="/icon.png" alt="Clasp-it logo" />
          Clasp-it
        </a>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-badge">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" fill="#c6613f" opacity="0.3"/>
            <circle cx="6" cy="6" r="2.5" fill="#c6613f"/>
          </svg>
          Chrome Extension + MCP Server
        </div>
        <h1>Pick any element.<br /><em>Fix it with AI.</em></h1>
        <p>Click any element on any webpage. Clasp-it captures the HTML, CSS, and context — your AI editor reads it and makes the edit.</p>
        <div className="hero-actions">
          {signupState === 'success' ? (
            <p className="hero-signup-success">Thanks! Check your email — your API key and download link are on their way.</p>
          ) : (
            <div className="hero-signup">
              <input
                type="email"
                placeholder="your@email.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSignup(); }}
                className={signupState === 'error' ? 'error' : ''}
              />
              <button
                className="btn btn-primary"
                onClick={handleSignup}
                disabled={signupState === 'loading'}
              >
                {signupState === 'loading' ? 'Sending…' : "Join beta — it's free"}
              </button>
            </div>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={openDemo}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M5.5 4.5L10 7L5.5 9.5V4.5Z" fill="currentColor"/>
            </svg>
            See demo
          </button>
        </div>
      </section>

      {/* How it works */}
      <section className="steps">
        <p className="section-label">How it works</p>
        <div className="steps-grid">
          <div className="step">
            <div className="step-visual">
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <rect x="10" y="10" width="60" height="45" rx="6" fill="rgba(198,97,63,0.08)" stroke="rgba(198,97,63,0.3)" strokeWidth="1.5"/>
                <rect x="18" y="18" width="20" height="12" rx="3" fill="rgba(198,97,63,0.15)" stroke="rgba(198,97,63,0.4)" strokeWidth="1.5"/>
                <rect x="42" y="18" width="20" height="12" rx="3" fill="rgba(0,0,0,0.05)" stroke="rgba(0,0,0,0.12)" strokeWidth="1"/>
                <rect x="18" y="34" width="44" height="8" rx="3" fill="rgba(0,0,0,0.04)" stroke="rgba(0,0,0,0.1)" strokeWidth="1"/>
                <circle cx="28" cy="24" r="2" fill="#c6613f"/>
                <path d="M52 52 L52 65 L56 61 L59 67 L61 66 L58 60 L63 60 Z" fill="#c6613f" stroke="white" strokeWidth="1"/>
              </svg>
            </div>
            <div className="step-num">1</div>
            <h3>Pick an element</h3>
            <p>Click the Clasp-it icon, then click any element on any webpage. A prompt box appears.</p>
          </div>
          <div className="step">
            <div className="step-visual">
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <rect x="10" y="20" width="60" height="40" rx="8" fill="rgba(198,97,63,0.08)" stroke="rgba(198,97,63,0.3)" strokeWidth="1.5"/>
                <rect x="18" y="28" width="44" height="6" rx="3" fill="rgba(0,0,0,0.06)"/>
                <rect x="18" y="38" width="35" height="6" rx="3" fill="rgba(0,0,0,0.06)"/>
                <rect x="50" y="48" width="14" height="6" rx="3" fill="#c6613f"/>
                <rect x="54" y="38" width="2" height="6" rx="1" fill="#c6613f"/>
              </svg>
            </div>
            <div className="step-num">2</div>
            <h3>Describe the change</h3>
            <p>Type what you want — "make this button bigger", "fix the spacing", "change to primary style".</p>
          </div>
          <div className="step">
            <div className="step-visual">
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <rect x="8" y="14" width="64" height="44" rx="7" fill="rgba(20,20,19,0.06)" stroke="rgba(0,0,0,0.12)" strokeWidth="1.5"/>
                <rect x="8" y="14" width="64" height="14" rx="7" fill="rgba(20,20,19,0.1)"/>
                <circle cx="20" cy="21" r="2.5" fill="rgba(198,97,63,0.5)"/>
                <circle cx="28" cy="21" r="2.5" fill="rgba(0,0,0,0.2)"/>
                <circle cx="36" cy="21" r="2.5" fill="rgba(0,0,0,0.2)"/>
                <rect x="16" y="34" width="8" height="3" rx="1.5" fill="#c6613f" opacity="0.7"/>
                <rect x="27" y="34" width="28" height="3" rx="1.5" fill="rgba(0,0,0,0.15)"/>
                <rect x="16" y="41" width="12" height="3" rx="1.5" fill="rgba(0,0,0,0.1)"/>
                <rect x="31" y="41" width="20" height="3" rx="1.5" fill="rgba(0,0,0,0.1)"/>
                <circle cx="60" cy="56" r="10" fill="#c6613f"/>
                <path d="M55 56 L58.5 59.5 L65 53" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="step-num">3</div>
            <h3>Your editor fixes it</h3>
            <p>Switch to your AI editor and say "fix my recent picks". It reads the context and edits your code.</p>
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="setup" id="setup">
        <h2>Two-minute setup</h2>
        <p>One extension, one terminal command. That's it.</p>
        <div className="setup-steps">
          <div className="setup-step">
            <div className="setup-step-num">1</div>
            <div className="setup-step-body">
              <h4>Install the Chrome extension</h4>
              <p>Add Clasp-it from the Chrome Web Store. Sign up with your email to get a free API key.</p>
            </div>
          </div>
          <div className="setup-step">
            <div className="setup-step-num">2</div>
            <div className="setup-step-body">
              <h4>Connect your AI editor</h4>
              <p>Add Clasp-it as an MCP server — setup instructions are in the extension settings for Claude Code, Cursor, and Windsurf.</p>
            </div>
          </div>
          <div className="setup-step">
            <div className="setup-step-num">3</div>
            <div className="setup-step-body">
              <h4>Start picking</h4>
              <p>Click any element, type your instruction, hit send. Then tell your editor: <em>"fix all recent picks using clasp-it"</em>.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="pricing">
        <h2>Simple pricing</h2>
        <p>Free to start. Cancel anytime.</p>
        <div className="pricing-grid">
          <div className="plan">
            <p className="plan-name">Free</p>
            <p className="plan-price">$0</p>
            <p className="plan-desc">10 picks per day, always free.</p>
            <a href="https://chrome.google.com/webstore" className="plan-cta plan-cta-free">Get started free</a>
            <hr className="plan-divider" />
            <ul className="plan-features">
              <li>DOM &amp; selector</li>
              <li>Computed styles</li>
              <li>10 picks / day</li>
              <li className="muted">Screenshot</li>
              <li className="muted">Console logs</li>
              <li className="muted">Network requests</li>
              <li className="muted">React props</li>
            </ul>
          </div>
          <div className="plan pro">
            <div className="plan-badge">✦ Most popular</div>
            <p className="plan-name">Pro</p>
            <p className="plan-price">$2.99 <span>/mo</span></p>
            <p className="plan-desc">Unlimited picks + full context capture. Or save 33% at $24/yr.</p>
            <a href="/upgrade" id="pro-cta" className="plan-cta plan-cta-pro" onClick={() => observe.track('upgrade_cta_clicked')}>Get Pro — $2.99/mo</a>
            <hr className="plan-divider" />
            <ul className="plan-features">
              <li>Everything in Free</li>
              <li>Unlimited picks</li>
              <li>Screenshot</li>
              <li>Console logs</li>
              <li>Network requests</li>
              <li>React props</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer>
        <p>© 2026 Clasp-it</p>
        <div className="footer-links">
          <a href="mailto:dev@madhans.world">dev@madhans.world</a>
          <a href="/privacy">Privacy Policy</a>
        </div>
      </footer>
    </>
  );
}
