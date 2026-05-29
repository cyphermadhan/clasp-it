import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/global.css';
import '../../webmcp.js';
import './home.css';
import Home from './Home.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Home />
  </StrictMode>
);
