import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

// US-017 / Step 3.2: the SPA now builds the FeedbackEnvelope and POSTs it via
// the default `fetchTransport` (approve → /api/approve, revise → /api/deny).
// No stub callbacks needed — App owns emission end-to-end.
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
