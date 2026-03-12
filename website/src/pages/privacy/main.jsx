import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/global.css';
import './privacy.css';
import Privacy from './Privacy.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Privacy />
  </StrictMode>
);
