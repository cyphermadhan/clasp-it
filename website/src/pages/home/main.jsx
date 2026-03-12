import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/global.css';
import './home.css';
import observe from '../../analytics.js';
import Home from './Home.jsx';

observe.track('page_view', { page: 'landing' });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Home />
  </StrictMode>
);
