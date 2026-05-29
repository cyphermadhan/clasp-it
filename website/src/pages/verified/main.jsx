import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/global.css';
import '../../webmcp.js';
import './verified.css';
import Verified from './Verified.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Verified />
  </StrictMode>
);
