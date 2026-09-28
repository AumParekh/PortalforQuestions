/**
 * Who is studying: two people share this app on one device, each with their own progress, settings and exam date.
 * The picker (components/ProfilePicker.tsx) asks on every page load; main.tsx calls `setActiveProfile` with the
 * answer and only then loads the app, so every store opens its own profile's storage:
 *   - IndexedDB 'frm-portal-<id>' and 'frm-games-<id>' (`profileDbName`)
 *   - localStorage 'frm.<thing>.v1.<id>' (`profileKey`)
 * The theme stays shared (index.html reads it before anything loads). Switching reloads the page, so no store ever
 * holds one profile's state while the other is active.
 *
 * Plain storage code with no UI or store imports; it lives in games/ for the same reason as examDate.ts (the games
 * layer imports nothing from outside its own folder, and games/db.ts needs the database name).
 */

export type ProfileId = 'chelsi' | 'aum';

export interface Profile {
  id: ProfileId;
  name: string;
  /** Local YYYY-MM-DD: the exam date this profile starts with (each can change it in Settings). */
  examDate: string;
}

export const PROFILES: readonly Profile[] = [
  { id: 'chelsi', name: 'Chelsi', examDate: '2026-11-24' },
  { id: 'aum', name: 'Aum', examDate: '2026-11-25' },
];

/** Global (not per profile): who used this device last, highlighted in the picker. */
const LAST_PROFILE_KEY = 'frm.profile.last';
/** Per tab, set by "Switch user" just before it reloads: the picker highlights the other person once. */
const SWITCH_TO_KEY = 'frm.profile.switchTo';
/** Global: set once the progress saved before profiles existed has been wiped. */
const PROFILES_FLAG = 'frm.profiles.v1';

export function isProfileId(v: unknown): v is ProfileId {
  return PROFILES.some((p) => p.id === v);
}

export function profileById(id: ProfileId): Profile {
  return PROFILES.find((p) => p.id === id) ?? PROFILES[0];
}

let active: Profile | null = null;

/** Called once per page load, by main.tsx, before the app (and so any store) is loaded. */
export function setActiveProfile(id: ProfileId) {
  active = profileById(id);
  try {
    window.localStorage.setItem(LAST_PROFILE_KEY, id);
  } catch {
    // Storage blocked: the picker just won't remember who was last.
  }
}

/** The profile chosen for this page load, or null before the picker has been answered. */
export function activeProfileOrNull(): Profile | null {
  return active;
}

/** The profile chosen for this page load. Throws before the picker has been answered: nothing may touch storage then. */
export function activeProfile(): Profile {
  if (!active) throw new Error('No profile chosen yet');
  return active;
}

/** A localStorage key for the active profile: 'frm.settings.v1' → 'frm.settings.v1.aum'. */
export function profileKey(base: string): string {
  return `${base}.${activeProfile().id}`;
}

/** An IndexedDB name for the active profile: 'frm-portal' → 'frm-portal-aum'. */
export function profileDbName(base: string): string {
  return `${base}-${activeProfile().id}`;
}

/** The profile the picker highlights: the other person right after "Switch user", else whoever was here last. */
export function suggestedProfile(): ProfileId {
  try {
    const next = window.sessionStorage.getItem(SWITCH_TO_KEY);
    window.sessionStorage.removeItem(SWITCH_TO_KEY);
    if (isProfileId(next)) return next;
  } catch {
    // Session storage blocked; fall through.
  }
  try {
    const last = window.localStorage.getItem(LAST_PROFILE_KEY);
    if (isProfileId(last)) return last;
  } catch {
    // Storage blocked; fall through.
  }
  return PROFILES[0].id;
}

/** "Switch user": back to Home and the picker, with a full reload so every store starts over for the other person. */
export function switchProfile() {
  const other = PROFILES.find((p) => p.id !== active?.id);
  try {
    if (other) window.sessionStorage.setItem(SWITCH_TO_KEY, other.id);
  } catch {
    // The picker then highlights the last profile instead.
  }
  try {
    window.history.replaceState(null, '', '#/');
  } catch {
    // Reload where we are; Home is one tap away.
  }
  window.location.reload();
}

// ---- One-time wipe of the progress saved before profiles existed ----

/** Databases and per-user localStorage keys from before profiles (the theme is kept). */
const SHARED_DBS = ['frm-portal', 'frm-games'];
const SHARED_KEYS = [
  'frm.settings.v1',
  'frm.sessionSetup.v1',
  'frm.senseCheck.v1',
  'frm.truefalse.v1',
  'frm.formulaGym.v1',
  'frm.mockAttempts.v1',
];
const DELETE_TIMEOUT_MS = 3000;

/** Resolves true once the database is gone (or never existed); false if the browser refused or never answered. */
function deleteDb(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(true);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.deleteDatabase(name);
    } catch {
      resolve(false);
      return;
    }
    const timer = window.setTimeout(() => resolve(false), DELETE_TIMEOUT_MS);
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      resolve(ok);
    };
    req.onsuccess = () => done(true);
    req.onerror = () => done(false);
    // A tab still running the old app holds it open: the delete is queued and finishes once that tab lets go (the old
    // app closes its connection on a delete). Nothing reads these names any more, so don't wait for it.
    req.onblocked = () => done(true);
  });
}

/**
 * Deletes the shared, pre-profile progress once per device, so both people start empty. Runs before the picker is
 * answered (the app isn't loaded yet, so nothing has these open in this tab). Retried on the next load if a
 * database couldn't be deleted; that is harmless, since nothing uses the old names any more.
 */
export async function wipeSharedProgress(): Promise<void> {
  try {
    if (window.localStorage.getItem(PROFILES_FLAG)) return;
  } catch {
    // Can't read the flag: wipe anyway (the old names are unused, so doing it again later loses nothing).
  }
  const results = await Promise.all(SHARED_DBS.map(deleteDb));
  for (const key of SHARED_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage blocked: nothing there to remove from this tab's point of view.
    }
  }
  if (results.every(Boolean)) {
    try {
      window.localStorage.setItem(PROFILES_FLAG, new Date().toISOString());
    } catch {
      // Storage blocked; the wipe runs again next load, which is harmless.
    }
  }
}
