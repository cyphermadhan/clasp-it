import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/global.css';
import './verified.css';
import observe from '../../analytics.js';
import Verified from './Verified.jsx';

const isCheckout = new URLSearchParams(window.location.search).get('checkout') === 'success';
observe.track(isCheckout ? 'upgrade_completed' : 'email_verified');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Verified />
  </StrictMode>
);
