import { useState, useEffect, useCallback } from 'react';
import observe from '../../analytics.js';

const CWS_URL = 'https://chromewebstore.google.com/detail/clasp-it/inelkjifjfaepgpdndcgdkpmlopggnlk';

// ── Icons ────────────────────────────────────────────────────────────────────

const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <circle cx="6.5" cy="6.5" r="6" fill="currentColor" opacity="0.15"/>
    <path d="M3.5 6.5L5.5 8.5L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconDash = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <circle cx="6.5" cy="6.5" r="6" fill="currentColor" opacity="0.1"/>
    <path d="M4 6.5H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const IconPlay = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <circle cx="6.5" cy="6.5" r="6" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M5.2 4.8L9 6.5L5.2 8.2V4.8Z" fill="currentColor"/>
  </svg>
);

const IconArrow = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <path d="M2 9L9 2M9 2H4M9 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconSun = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.5 2.5l.7.7M8.8 8.8l.7.7M2.5 9.5l.7-.7M8.8 3.2l.7-.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const IconMoon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M10 7.5A4.5 4.5 0 014.5 2a4.5 4.5 0 100 9 4.5 4.5 0 005.5-3.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

const IconSystem = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect x="1" y="2" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
    <path d="M4 11h4M6 9v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

// Extension plug icon
const IconExtension = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="3" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M7 13v2M13 13v2M7 7h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

// Server icon
const IconServer = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="3" y="4" width="14" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
    <rect x="3" y="11" width="14" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
    <circle cx="15" cy="6.5" r="1" fill="currentColor"/>
    <circle cx="15" cy="13.5" r="1" fill="currentColor"/>
  </svg>
);

// Code editor icon
const IconEditor = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M6 8l-3 2 3 2M14 8l3 2-3 2M11 7l-2 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// ── Theme helpers ─────────────────────────────────────────────────────────────

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  return localStorage.getItem('clasp-theme') || 'dark';
}

function applyTheme(preference) {
  const resolved = preference === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  document.documentElement.setAttribute('data-theme', resolved);
}

// ── Card tilt handler ─────────────────────────────────────────────────────────

function useTilt() {
  const onMove = useCallback((e) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `perspective(700px) rotateX(${-y * 5}deg) rotateY(${x * 5}deg) scale(1.015)`;
  }, []);

  const onLeave = useCallback((e) => {
    e.currentTarget.style.transform = '';
  }, []);

  return { onMouseMove: onMove, onMouseLeave: onLeave };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Home() {
  const [demoOpen, setDemoOpen]   = useState(false);
  const [scrolled, setScrolled]   = useState(false);
  const [theme, setTheme]         = useState(getInitialTheme);

  const openDemo  = () => { observe.track('demo_opened'); setDemoOpen(true); };
  const closeDemo = () => setDemoOpen(false);
  const tilt      = useTilt();

  // Apply theme on change
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('clasp-theme', theme);

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  // Nav glass on scroll
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll-based entrance animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in-view');
          observer.unobserve(e.target);
        }
      }),
      { threshold: 0.08 },
    );
    document.querySelectorAll('.animate-in').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Escape closes demo
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeDemo(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = demoOpen ? 'hidden' : '';
  }, [demoOpen]);

  // Pricing scroll from hash
  useEffect(() => {
    if (window.location.hash === '#pricing') {
      document.querySelector('.pricing-section')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  return (
    <>
      {/* ── Demo modal ─────────────────────────────────────────── */}
      <div
        className={`demo-overlay${demoOpen ? ' open' : ''}`}
        onClick={(e) => { if (e.target === e.currentTarget) closeDemo(); }}
      >
        <div className="demo-modal">
          <button className="demo-close" onClick={closeDemo} aria-label="Close">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1 1L10 10M10 1L1 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
          <iframe
            src="https://www.loom.com/embed/c57056eebd6c440696274bccc6730ffd"
            allowFullScreen
          />
        </div>
      </div>

      {/* ── Nav ────────────────────────────────────────────────── */}
      <nav className={scrolled ? 'scrolled' : ''}>
        <a href="/" className="nav-logo">
          <img src="/icon.png" alt="Clasp-it" />
          Clasp-it
        </a>
        <div className="nav-right">
          <a
            href="#pricing"
            className="nav-link"
            onClick={(e) => {
              e.preventDefault();
              document.querySelector('.pricing-section')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            Pricing
          </a>
          <a
            href={CWS_URL}
            className="btn btn-primary"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => observe.track('install_cws_clicked')}
          >
            Add to Chrome
          </a>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />

        <div className="hero-badge">
          <span className="hero-badge-dot" aria-hidden="true" />
          Now on Chrome Web Store
        </div>

        <h1>
          Click any element.<br />
          <em>Fix it with AI.</em>
        </h1>

        <p className="hero-sub">
          Clasp-it captures full context — HTML, CSS, React props, screenshots —
          and delivers it to your AI editor via MCP. No copy-pasting. No describing.
        </p>

        <div className="hero-actions">
          <a
            href={CWS_URL}
            className="btn btn-primary btn-hero"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => observe.track('install_cws_clicked')}
          >
            Add to Chrome — free
          </a>
          <button className="btn btn-ghost btn-hero" onClick={openDemo}>
            <IconPlay /> See demo
          </button>
        </div>

        {/* 3D browser mockup */}
        <div className="hero-mockup-wrap">
          <div className="hero-mockup">
            <div className="mockup-browser">

              {/* Chrome bar */}
              <div className="mockup-chrome">
                <div className="mockup-dots">
                  <span /><span /><span />
                </div>
                <div className="mockup-url">claspit.dev/dashboard</div>
              </div>

              {/* Page body */}
              <div className="mockup-body">

                {/* Fake page nav */}
                <div className="mockup-topbar">
                  <div className="mockup-logo-group">
                    <div className="mockup-logo-box" />
                    <div className="mockup-logo-text" />
                  </div>
                  <div className="mockup-nav-links">
                    <div className="mockup-nav-link" />
                    <div className="mockup-nav-link" />
                    <div className="mockup-nav-link" />
                  </div>
                </div>

                {/* Content grid */}
                <div className="mockup-content-grid">
                  <div className="mockup-card-block">
                    <div className="mockup-line w100" />
                    <div className="mockup-line w70" />
                    <div className="mockup-line w55" />
                  </div>
                  <div className="mockup-card-block">
                    <div className="mockup-line w70" />
                    <div className="mockup-line w100" />
                    <div className="mockup-line w40" />
                  </div>
                </div>

                {/* Highlighted / picked element */}
                <div className="mockup-picked">
                  <div className="mockup-picked-tag">button.cta-primary</div>
                  <div className="mockup-picked-row">
                    <div className="mockup-btn-fill" />
                    <div className="mockup-btn-outline" />
                  </div>
                </div>

                <div className="mockup-line w70" style={{ marginBottom: 0 }} />

                {/* Floating Clasp-it dialog */}
                <div className="mockup-dialog">
                  <div className="mockup-dialog-head">
                    <span className="mockup-dialog-tag">button.cta-primary</span>
                    <div className="mockup-dialog-x">×</div>
                  </div>
                  <div className="mockup-dialog-input-area">
                    make this violet and round the corners
                    <span className="mockup-cursor" aria-hidden="true" />
                  </div>
                  <div className="mockup-dialog-foot">
                    <div className="mockup-send">
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <path d="M5.5 9.5V1.5M1.5 5.5L5.5 1.5L9.5 5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Social proof bar ───────────────────────────────────── */}
      <div className="proof-bar">
        Works with
        <span className="proof-sep" />
        Claude Code
        <span className="proof-sep" />
        Cursor
        <span className="proof-sep" />
        Windsurf
        <span className="proof-sep" />
        Any MCP editor
      </div>

      {/* ── Feature bento ──────────────────────────────────────── */}
      <section className="bento-section">
        <p className="bento-section-label animate-in">How it works</p>

        <div className="bento">

          {/* FIG.01 — Element picker (tall) */}
          <div
            className="bento-card bento-01 animate-in"
            style={{ '--delay': '0ms' }}
            {...tilt}
          >
            <span className="bento-fig">FIG.01</span>
            <span className="bento-arrow" aria-hidden="true"><IconArrow /></span>

            <div className="bento-visual">
              <div className="mini-browser-wrap">
                <div className="mini-browser">
                  <div className="mini-chrome">
                    <div className="mini-dots">
                      <span /><span /><span />
                    </div>
                    <div className="mini-url-bar" />
                  </div>
                  <div className="mini-body">
                    <div className="mini-line w80" />
                    <div className="mini-line w60" />
                    <div className="mini-picked">
                      <div className="mini-picked-tag">div.hero</div>
                      <div className="mini-btn-fill" />
                      <div className="mini-btn-ghost" />
                    </div>
                    <div className="mini-line w45" />
                  </div>
                </div>
              </div>
              {/* Cursor SVG */}
              <svg className="picker-cursor-svg" viewBox="0 0 20 20" fill="none">
                <path d="M4 3L9.5 17L12 11L18 8.5L4 3Z" fill="currentColor" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round"/>
              </svg>
            </div>

            <div className="bento-text">
              <h3>Click any element</h3>
              <p>
                Hit Pick Element, hover over anything on any webpage.
                Clasp-it highlights it live. Click to capture.
              </p>
            </div>
          </div>

          {/* FIG.02 — Context capture (top right) */}
          <div
            className="bento-card bento-02 animate-in"
            style={{ '--delay': '80ms' }}
            {...tilt}
          >
            <span className="bento-fig">FIG.02</span>
            <span className="bento-arrow" aria-hidden="true"><IconArrow /></span>

            <div className="bento-visual">
              <div className="layers-wrap">
                {[
                  { label: 'HTML',   value: '<div class="hero">' },
                  { label: 'CSS',    value: 'display: flex' },
                  { label: 'REACT',  value: 'props.variant' },
                ].map(({ label, value }) => (
                  <div className="ctx-layer" key={label}>
                    <div className="ctx-label">{label}</div>
                    <div className="ctx-value">{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bento-text">
              <h3>Full context, zero effort</h3>
              <p>
                HTML, computed CSS, React props, console logs, network
                requests, and a screenshot — captured in one click.
              </p>
            </div>
          </div>

          {/* FIG.03 — MCP bridge (bottom right) */}
          <div
            className="bento-card bento-03 animate-in"
            style={{ '--delay': '160ms' }}
            {...tilt}
          >
            <span className="bento-fig">FIG.03</span>
            <span className="bento-arrow" aria-hidden="true"><IconArrow /></span>

            <div className="bento-visual">
              <div className="mcp-bridge">
                <div className="mcp-node">
                  <div className="mcp-icon"><IconExtension /></div>
                  <div className="mcp-label">EXTENSION</div>
                </div>

                <div className="mcp-wire">
                  <div className="mcp-dot" />
                </div>

                <div className="mcp-node">
                  <div className="mcp-icon"><IconServer /></div>
                  <div className="mcp-label">MCP SERVER</div>
                </div>

                <div className="mcp-wire">
                  <div className="mcp-dot mcp-dot-b" />
                </div>

                <div className="mcp-node">
                  <div className="mcp-icon"><IconEditor /></div>
                  <div className="mcp-label">YOUR EDITOR</div>
                </div>
              </div>
            </div>

            <div className="bento-text">
              <h3>Delivered via MCP</h3>
              <p>
                One terminal command connects your editor. Clasp-it
                speaks MCP — tell Claude or Cursor to fix your picks.
              </p>
            </div>
          </div>

          {/* FIG.04 — Works with editors (wide) */}
          <div
            className="bento-card bento-04 animate-in"
            style={{ '--delay': '240ms' }}
          >
            <span className="bento-fig">FIG.04</span>

            <div className="bento-visual">
              <div className="editors-row">
                {['Claude Code', 'Cursor', 'Windsurf'].map((name) => (
                  <div className="editor-chip" key={name}>
                    <span className="editor-chip-dot" />
                    {name}
                  </div>
                ))}
              </div>
            </div>

            <div className="bento-text">
              <h3>Works with the editors you already use</h3>
              <p>
                Any editor that supports MCP tool calls. Setup instructions for
                Claude Code, Cursor, and Windsurf are built into the extension sidebar.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────── */}
      <section className="pricing-section">
        <h2 className="section-heading animate-in">Simple pricing</h2>
        <p className="section-sub animate-in" style={{ '--delay': '60ms' }}>
          Free to start. Upgrade when you need more.
        </p>

        <div className="pricing-grid">

          {/* Free */}
          <div className="plan animate-in" style={{ '--delay': '100ms' }} {...tilt}>
            <p className="plan-tier">Free</p>
            <p className="plan-price">$0</p>
            <p className="plan-desc">10 picks per day, forever free.</p>
            <a
              href={CWS_URL}
              className="plan-cta plan-cta-free"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => observe.track('install_cws_clicked')}
            >
              Get started free
            </a>
            <hr className="plan-divider" />
            <ul className="plan-features">
              <li><IconCheck /> DOM &amp; selector</li>
              <li><IconCheck /> Computed styles</li>
              <li><IconCheck /> 10 picks / day</li>
              <li className="dim"><IconDash /> Screenshot</li>
              <li className="dim"><IconDash /> Console logs</li>
              <li className="dim"><IconDash /> Network requests</li>
              <li className="dim"><IconDash /> React props</li>
            </ul>
          </div>

          {/* Pro */}
          <div className="plan pro animate-in" style={{ '--delay': '180ms' }} {...tilt}>
            <div className="plan-badge">✦ Most popular</div>
            <p className="plan-tier">Pro</p>
            <p className="plan-price">$2.99 <span>/mo</span></p>
            <p className="plan-desc">Unlimited picks + full context. Or save 33% at $24/yr.</p>
            <a
              href="/upgrade"
              className="plan-cta plan-cta-pro"
              onClick={() => observe.track('upgrade_cta_clicked')}
            >
              Get Pro — $2.99/mo
            </a>
            <hr className="plan-divider" />
            <ul className="plan-features">
              <li><IconCheck /> Everything in Free</li>
              <li><IconCheck /> Unlimited picks</li>
              <li><IconCheck /> Screenshot</li>
              <li><IconCheck /> Console logs</li>
              <li><IconCheck /> Network requests</li>
              <li><IconCheck /> React props</li>
            </ul>
          </div>

        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="site-footer">
        <div className="footer-left">
          <span className="footer-copy">© 2026 Clasp-it</span>
          <div className="footer-links">
            <a href="mailto:dev@madhans.world">Contact</a>
            <a href="/privacy">Privacy</a>
          </div>
        </div>

        {/* Theme toggle */}
        <div className="theme-toggle" role="group" aria-label="Theme">
          {[
            { value: 'light',  label: 'Light',  Icon: IconSun },
            { value: 'system', label: 'System', Icon: IconSystem },
            { value: 'dark',   label: 'Dark',   Icon: IconMoon },
          ].map(({ value, label, Icon }) => (
            <button
              key={value}
              className={`theme-btn${theme === value ? ' active' : ''}`}
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
            >
              <Icon /> {label}
            </button>
          ))}
        </div>
      </footer>
    </>
  );
}
