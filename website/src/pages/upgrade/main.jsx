import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/global.css';
import '../../webmcp.js';
import './upgrade.css';
import Upgrade from './Upgrade.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Upgrade />
  </StrictMode>
);
