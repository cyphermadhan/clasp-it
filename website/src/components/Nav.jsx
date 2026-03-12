export default function Nav() {
  return (
    <nav style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '20px 40px',
      maxWidth: 1000,
      margin: '0 auto',
    }}>
      <a href="/" style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 17,
        fontWeight: 600,
        color: 'var(--text)',
        letterSpacing: '-0.3px',
      }}>
        <img src="/icon.png" alt="Clasp-it logo" width={24} height={24} />
        Clasp-it
      </a>
    </nav>
  );
}
