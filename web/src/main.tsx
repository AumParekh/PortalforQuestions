import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles/globals.css';
import { ProfilePicker } from './components/ProfilePicker';
import { setActiveProfile, suggestedProfile, wipeSharedProgress } from './games/profile';
import type { ProfileId } from './games/profile';

const root = createRoot(document.getElementById('root')!);
// Deletes the progress saved before profiles existed (once per device); started now so it has finished, or nearly,
// by the time someone picks.
const wiped = wipeSharedProgress();

/**
 * The app (and with it every store, each of which reads its profile's storage) is only imported once the person is
 * known: nothing can open the wrong profile's data, or any data at all, before the question is answered.
 */
async function start(id: ProfileId) {
  setActiveProfile(id);
  await wiped;
  const { startApp } = await import('./start');
  startApp(root);
}

// Asked on every page load; moving around inside the app (hash changes) keeps the answer.
root.render(
  <StrictMode>
    <ProfilePicker suggested={suggestedProfile()} onChoose={start} />
  </StrictMode>,
);
