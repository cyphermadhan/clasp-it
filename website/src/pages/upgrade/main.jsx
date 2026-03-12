import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/global.css';
import './upgrade.css';
import observe from '../../analytics.js';
import Upgrade from './Upgrade.jsx';

observe.track('page_view', { page: 'upgrade' });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Upgrade />
  </StrictMode>
);
