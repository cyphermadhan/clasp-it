import { observe } from './vibesignals.mjs';

const vs = observe({ apiKey: 'mlNJcxp0V4JUH2CA8B1DyGDLqHvletalhS0ar38UbE2' });

// Safe global wrapper — sidepanel.js calls window.track()
window.track = (event, props) => {
  try { vs.track(event, props); } catch {}
};
