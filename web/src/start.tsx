import { StrictMode } from 'react';
import type { Root } from 'react-dom/client';
import App from './App';
import { applySettings } from './lib/settings';

/**
 * The app proper, loaded by main.tsx only once the profile is chosen: importing this module imports every store, and
 * some read their profile's storage as they load (lib/settings.ts).
 */
export function startApp(root: Root) {
  applySettings();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
