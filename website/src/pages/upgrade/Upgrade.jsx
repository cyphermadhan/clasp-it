import { useState } from 'react';
import observe from '../../analytics.js';

export default function Upgrade() {
  const [email, setEmail] = useState(() => {
    return new URLSearchParams(window.location.search).get('e') || '';
  });
  const [billing, setBilling] = useState('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUpgrade = async () => {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    observe.track('upgrade_checkout_started');
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, plan: 'pro', billing }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Something went wrong. Please try again.');
        setLoading(false);
      }
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  };

  const isAnnual = billing === 'annual';

  return (
    <>
      <a href="/" className="nav-logo">
        <img src="/icon.png" alt="Clasp-it" />
        Clasp-it
      </a>
      <div className="card">
        <h1>Upgrade to Pro</h1>
        <p className="subtitle">Unlimited picks + full context capture.</p>

        <div className="billing-toggle">
          <button
            className={`billing-btn${!isAnnual ? ' active' : ''}`}
            onClick={() => setBilling('monthly')}
          >
            Monthly
          </button>
          <button
            className={`billing-btn${isAnnual ? ' active' : ''}`}
            onClick={() => setBilling('annual')}
          >
            Annual <span className="save-badge">Save 33%</span>
          </button>
        </div>

        <div className="price">
          {isAnnual ? '$24' : '$2.99'}
          <span>{isAnnual ? '/yr' : '/mo'}</span>
        </div>
        {isAnnual && <p className="price-note">billed annually · $2/mo</p>}

        <ul className="features">
          <li>Unlimited picks per day</li>
          <li>Screenshot capture</li>
          <li>Console logs</li>
          <li>Network requests</li>
          <li>React props</li>
        </ul>
        <input
          className="email-input"
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleUpgrade(); }}
        />
        <button
          className="btn-upgrade"
          onClick={handleUpgrade}
          disabled={loading}
        >
          {loading ? 'Redirecting to checkout…' : `Get Pro — ${isAnnual ? '$24/yr' : '$2.99/mo'}`}
        </button>
        {error && <div className="error-msg">{error}</div>}
        <p className="back">← <a href="/">Back to home</a></p>
      </div>
    </>
  );
}
