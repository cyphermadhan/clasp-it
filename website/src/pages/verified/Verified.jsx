const CheckIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M5 13l4 4L19 7" stroke="#c6613f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default function Verified() {
  const isCheckout = new URLSearchParams(window.location.search).get('checkout') === 'success';

  return (
    <>
      <a href="/" className="nav-logo">
        <img src="/icon.png" alt="Clasp-it logo" />
        Clasp-it
      </a>
      <div className="card">
        <div className="icon">
          <CheckIcon />
        </div>
        {isCheckout ? (
          <>
            <h1>You're on Pro!</h1>
            <p>Your plan has been upgraded. Open the Clasp-it extension and tap <strong>"Already upgraded? Refresh"</strong> to activate unlimited picks.</p>
          </>
        ) : (
          <>
            <h1>You're verified!</h1>
            <p>Your API key has been created. Return to the Clasp-it extension — it should be ready to use.</p>
          </>
        )}
      </div>
    </>
  );
}
