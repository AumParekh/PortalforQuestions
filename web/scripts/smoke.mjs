// Browser smoke test for the built portal: opens every screen in Chromium at phone and desktop
// widths and fails on uncaught errors, console errors, failed content requests, a screen that
// renders nothing, or horizontal page overflow at 375px. Every page load starts on the "Who's studying?" picker; the
// run studies as Aum, then checks that switching to Chelsi shows her own, empty progress and her own exam date.
//
//   BASE=http://localhost:4173 node scripts/smoke.mjs
import { chromium } from 'playwright';

const BASE = (process.env.BASE ?? 'http://localhost:4173').replace(/\/$/, '');
const ROUTES = ['/', '/setup', '/truefalse', '/analytics', '/settings', '/review', '/formulas', '/sense', '/games'];
// Sections with a Start button that can be played from the keyboard.
const PLAYABLE = [
  { route: '/truefalse', buttons: [/^\s*Start\s*$/], required: true },
  { route: '/formulas', buttons: [/^\s*Start\s*$/], required: true },
  { route: '/sense', buttons: [/^\s*Start\s*$/], required: true },
  // Notes games: auto-pick Play (after the 9 MB notes file loads), the briefing's Start, then the arc's Begin.
  { route: '/games', buttons: [/^\s*Play\s*$/, /^\s*Start\s*$/, /^\s*Begin\s*$/], required: true },
];
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 800 },
  { name: 'desktop', width: 1280, height: 900 },
];
// Noise that isn't an app failure.
const IGNORE = [/favicon/i, /Download the React DevTools/i];

// The first mock exam in the manifest, if any (mock content lands separately; without it the mock run is skipped).
const manifest = await fetch(`${BASE}/content/manifest.json`)
  .then((r) => (r.ok ? r.json() : []))
  .catch(() => []);
const mockPath = Array.isArray(manifest) ? manifest.find((p) => typeof p === 'string' && p.startsWith('mocks/') && p.endsWith('.json')) : undefined;
const mockSlug = mockPath ? mockPath.replace(/^mocks\//, '').replace(/\.json$/, '') : null;

// Every full page load opens on "Who's studying?" (two profiles, each with its own progress); hash-only navigations
// keep the answer. Picks `name` when the picker is showing; with `expect`, waits for it first (after a reload).
async function choose(page, name = 'Aum', { expect = false } = {}) {
  const picker = page.locator('[data-profile-picker]');
  if (expect) await picker.waitFor({ state: 'visible', timeout: 20000 });
  else await page.locator('#root > *').first().waitFor({ state: 'attached', timeout: 20000 });
  if ((await picker.count()) === 0) return;
  await picker.getByRole('button', { name: new RegExp(`^\\s*${name}\\b`) }).click();
  await picker.waitFor({ state: 'detached', timeout: 20000 });
  await page.waitForLoadState('networkidle');
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await choose(page);
}

const failures = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, serviceWorkers: 'block' });
  const page = await context.newPage();
  let errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/content/') && r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });

  // The profile picker every page load starts on: two choices, no overflow at 375px, and "2" picks Aum.
  errors = [];
  try {
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle', timeout: 30000 });
    const picker = page.locator('[data-profile-picker]');
    await picker.waitFor({ state: 'visible', timeout: 20000 });
    const names = (await picker.getByRole('button').allTextContents()).join(' | ');
    if (!/Chelsi/.test(names) || !/Aum/.test(names)) errors.push(`picker offers: ${names}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (vp.width <= 375 && overflow > 1) errors.push(`picker scrolls horizontally by ${overflow}px`);
    await page.keyboard.press('2');
    await picker.waitFor({ state: 'detached', timeout: 20000 });
    await page.getByText('Hi, Aum').first().waitFor({ state: 'visible', timeout: 20000 });
  } catch (e) {
    errors.push(`picker: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
  }
  if (errors.length) failures.push(`${vp.name} profile picker\n  ${errors.join('\n  ')}`);
  else console.log(`ok  ${vp.name} profile picker`);

  for (const route of ROUTES) {
    errors = [];
    const label = `${vp.name} #${route}`;
    try {
      await goto(page, `${BASE}/#${route}`);
      // Let lazy data (game-blocks, decks) load and skeletons settle.
      await page.waitForTimeout(1500);
      const state = await page.evaluate(() => ({
        text: document.body.innerText.trim(),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }));
      if (state.text.length < 40) errors.push(`renders almost nothing (${state.text.length} chars)`);
      if (/Couldn't load|Something went wrong/i.test(state.text)) errors.push(`error text on screen: ${state.text.slice(0, 160)}`);
      if (vp.width <= 375 && state.overflow > 1) errors.push(`page scrolls horizontally by ${state.overflow}px`);
    } catch (e) {
      errors.push(`navigation: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (errors.length) failures.push(`${label}\n  ${errors.join('\n  ')}`);
    else console.log(`ok  ${label}`);
  }
  // Play-through: start each playable section and drive it with its keyboard shortcuts
  // (Space reveals, 1 answers, Enter moves on), failing on any crash or console error.
  for (const { route, buttons, required } of PLAYABLE) {
    errors = [];
    const label = `${vp.name} play #${route}`;
    try {
      await goto(page, `${BASE}/#${route}`);
      await page.waitForTimeout(1500);
      let started = true;
      for (const name of buttons) {
        const button = page.getByRole('button', { name }).first();
        // Sections load their content lazily; give them time before deciding there's nothing to start.
        await button.waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
        if ((await button.count()) === 0 || !(await button.isEnabled())) {
          started = false;
          const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 240);
          errors.push(`no enabled button matching ${name}; screen says: ${text}`);
          break;
        }
        await button.click();
        await page.waitForTimeout(800);
      }
      if (!started) {
        if (!required) {
          errors = [];
          console.log(`--  ${label} (nothing to start; content not generated yet)`);
          continue;
        }
      } else {
        for (let i = 0; i < 12; i++) {
          for (const key of [' ', '1', 'Enter']) {
            await page.keyboard.press(key);
            await page.waitForTimeout(250);
          }
        }
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (vp.width <= 375 && overflow > 1) errors.push(`page scrolls horizontally by ${overflow}px during play`);
    } catch (e) {
      errors.push(`play: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (errors.length) failures.push(`${label}\n  ${errors.join('\n  ')}`);
    else console.log(`ok  ${label}`);
  }
  // Mock exam: briefing → Start → answer, flag and move with the keyboard → Submit via the confirm → results →
  // one question's review. No right/wrong signal may appear before submitting.
  if (!mockSlug) {
    console.log(`--  ${vp.name} mock exam (no mock file in the manifest yet; skipped)`);
  } else {
    errors = [];
    const label = `${vp.name} mock exam "${mockSlug}"`;
    const overflowCheck = async (where) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (vp.width <= 375 && overflow > 1) errors.push(`page scrolls horizontally by ${overflow}px on the ${where}`);
    };
    try {
      await goto(page, `${BASE}/#/`);
      await goto(page, `${BASE}/#/mock/${encodeURIComponent(mockSlug)}`);
      const start = page.getByRole('button', { name: /^\s*Start\s*$/ }).first();
      await start.waitFor({ state: 'visible', timeout: 20000 });
      await overflowCheck('briefing');
      await start.click();
      await page.getByRole('timer').first().waitFor({ state: 'visible', timeout: 15000 });
      for (const key of ['1', 'ArrowRight', 'b', 'ArrowRight', 'f', '3', 'ArrowRight', 'ArrowLeft', 'd', 'ArrowRight', 'ArrowRight']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(200);
      }
      // Back to question 3, answered D after changing from C.
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(300);
      const selected = await page.getByRole('button', { name: /^Option [A-E] \(selected\)$/ }).allTextContents();
      if (selected.length !== 1) errors.push(`expected one selected option on question 3, found ${selected.length}`);
      const leaked = await page.evaluate(() =>
        [...document.querySelectorAll('[aria-label]')].some((el) => /\((your answer, )?(correct|incorrect)|correct answer\)/i.test(el.getAttribute('aria-label') ?? '')),
      );
      if (leaked) errors.push('an answer is marked right or wrong before submitting');
      await overflowCheck('exam screen');
      await page.getByRole('button', { name: /Open the question navigator/ }).first().click();
      await page.getByRole('dialog', { name: 'Question navigator' }).waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(300);
      await overflowCheck('question navigator');
      const answeredCells = await page.getByRole('button', { name: /^Question \d+, answered/ }).count();
      if (answeredCells < 3) errors.push(`navigator shows ${answeredCells} answered questions, expected at least 3`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: /^\s*Submit\s*$/ }).first().click();
      const dialog = page.getByRole('alertdialog');
      await dialog.waitFor({ state: 'visible', timeout: 5000 });
      const dialogText = await dialog.innerText();
      if (!/unanswered/i.test(dialogText) || !/flagged/i.test(dialogText)) errors.push(`submit dialog doesn't state unanswered and flagged counts: ${dialogText.replace(/\s+/g, ' ')}`);
      await dialog.getByRole('button', { name: /^\s*Submit exam\s*$/ }).click();
      await page.getByRole('heading', { name: /By area/ }).waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(500);
      const results = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
      if (!/\d+ \/ \d+/.test(results)) errors.push(`results screen shows no score: ${results.slice(0, 200)}`);
      if (/pass mark of|you passed|you failed/i.test(results)) errors.push('results screen claims a pass mark');
      await overflowCheck('results screen');
      await page.getByRole('button', { name: /^\s*Flagged\s*\d+\s*$/ }).first().click();
      await page.getByRole('button', { name: /^\s*All\s*\d+\s*$/ }).first().click();
      await page.locator('main ol button').first().click();
      await page.getByRole('heading', { name: /^\s*Solution\s*$/ }).waitFor({ state: 'visible', timeout: 10000 });
      await overflowCheck('question review');
      if (/Couldn't load|Something went wrong/i.test(await page.evaluate(() => document.body.innerText))) errors.push('error text on screen');
    } catch (e) {
      const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      errors.push(`${e instanceof Error ? e.message.split('\n')[0] : String(e)}; screen says: ${text}`);
    }
    if (errors.length) failures.push(`${label}\n  ${errors.join('\n  ')}`);
    else console.log(`ok  ${label}`);
  }
  // Every registered notes game, one session each, at phone width (where layouts break first).
  if (vp.width <= 375) {
    // A hash-only goto to the route we're already on doesn't remount the screen (it would stay
    // mid-game), so pass through Home first.
    const openGamesHome = async () => {
      await goto(page, `${BASE}/#/`);
      await goto(page, `${BASE}/#/games`);
    };
    await openGamesHome();
    const tab = page.getByRole('button', { name: /^\s*By mechanic\s*$/ }).first();
    await tab.waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
    await tab.click().catch(() => undefined);
    await page.waitForSelector('li > button:not([disabled]) .g-strong', { timeout: 15000 }).catch(() => undefined);
    await page.waitForSelector('li > button:not([disabled]) .g-strong', { timeout: 15000 }).catch(() => undefined);
    const names = await page.$$eval('li > button:not([disabled]) .g-strong', (els) => els.map((e) => e.textContent?.trim() ?? ''));
    if (names.length === 0) failures.push(`${vp.name} games: no mechanics listed`);
    for (const mech of names) {
      errors = [];
      const label = `${vp.name} play game "${mech}"`;
      try {
        await openGamesHome();
        await page.getByRole('button', { name: /^\s*By mechanic\s*$/ }).first().click({ timeout: 20000 });
        await page.locator('li > button:not([disabled])', { hasText: mech }).first().click({ timeout: 15000 });
        for (const name of [/Pick a reading for me/, /^\s*Start\s*$/, /^\s*Begin\s*$/]) {
          const b = page.getByRole('button', { name }).first();
          await b.waitFor({ state: 'visible', timeout: 15000 });
          await b.click();
          await page.waitForTimeout(600);
        }
        for (let i = 0; i < 12; i++) {
          for (const key of [' ', '1', 'Enter']) {
            await page.keyboard.press(key);
            await page.waitForTimeout(200);
          }
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) errors.push(`page scrolls horizontally by ${overflow}px during play`);
      } catch (e) {
        const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        errors.push(`${e instanceof Error ? e.message.split('\n')[0] : String(e)}; screen says: ${text}`);
      }
      if (errors.length) failures.push(`${label}\n  ${errors.join('\n  ')}`);
      else console.log(`ok  ${label}`);
    }
  }
  // Profiles: Aum (everything above) has progress; Switch user reloads into the picker, and Chelsi's Home must be
  // empty and count down to her own exam date (24 Nov), with Aum's progress and date (25 Nov) still there after.
  if (vp.width > 375) {
    errors = [];
    const label = `${vp.name} profiles`;
    // Home's stores load progress asynchronously, so a bar at 0 right after render proves nothing: wait for progress
    // where some is expected, and give an empty profile the same time before reading it.
    const home = async (name, { progress }) => {
      const quest = page.getByRole('progressbar', { name: "Today's quest progress" }).first();
      await quest.waitFor({ state: 'visible', timeout: 20000 });
      if (progress) {
        await page
          .waitForFunction(() => Number(document.querySelector('[role="progressbar"][aria-label="Today\'s quest progress"]')?.getAttribute('aria-valuenow')) > 0, null, {
            timeout: 10000,
          })
          .catch(() => undefined);
      } else {
        await page.waitForTimeout(3000);
      }
      return {
        greeted: (await page.getByText(`Hi, ${name}`).count()) > 0,
        quest: Number(await quest.getAttribute('aria-valuenow')),
        exam: (await page.getByRole('button', { name: /Exam date/ }).first().getAttribute('aria-label')) ?? '',
      };
    };
    const switchTo = async (name) => {
      await page.getByRole('button', { name: /Switch user/ }).first().click();
      await choose(page, name, { expect: true });
    };
    try {
      // Answer one True/False card as Aum, so she has progress today whatever the play-throughs recorded (T answers;
      // the run may still be open from the play-through, or back on its setup screen).
      await goto(page, `${BASE}/#/truefalse`);
      const tfStart = page.getByRole('button', { name: /^\s*Start\s*$/ }).first();
      await tfStart.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
      if ((await tfStart.count()) > 0 && (await tfStart.isEnabled())) await tfStart.click();
      await page.waitForTimeout(800);
      for (const key of ['t', 'Enter', 't']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(400);
      }
      await goto(page, `${BASE}/#/`);
      let h = await home('Aum', { progress: true });
      if (!h.greeted) errors.push('Home does not greet Aum');
      if (!(h.quest > 0)) errors.push("Aum's Home shows no progress after answering a True/False card");
      if (!/Nov 25, 2026|25 Nov 2026/.test(h.exam)) errors.push(`Aum's countdown is not for 25 Nov 2026: ${h.exam}`);
      await page.getByRole('button', { name: /Switch user/ }).first().click();
      await page.locator('[data-profile-picker]').waitFor({ state: 'visible', timeout: 20000 });
      await page.waitForTimeout(200);
      // Right after Switch user the picker highlights (and focuses) the other person.
      const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
      if (!/Chelsi/.test(focused)) errors.push(`picker after Switch user focuses "${focused}", expected Chelsi`);
      await choose(page, 'Chelsi', { expect: true });
      h = await home('Chelsi', { progress: false });
      if (!h.greeted) errors.push('Home does not greet Chelsi');
      if (h.quest !== 0) errors.push(`Chelsi's Home shows Aum's progress (quest at ${h.quest}%)`);
      if (!/Nov 24, 2026|24 Nov 2026/.test(h.exam)) errors.push(`Chelsi's countdown is not for 24 Nov 2026: ${h.exam}`);
      await switchTo('Aum');
      h = await home('Aum', { progress: true });
      if (!(h.quest > 0)) errors.push("Aum's progress is gone after switching back");
      if (!/Nov 25, 2026|25 Nov 2026/.test(h.exam)) errors.push(`Aum's countdown is not for 25 Nov 2026 after switching back: ${h.exam}`);
    } catch (e) {
      const text = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      errors.push(`${e instanceof Error ? e.message.split('\n')[0] : String(e)}; screen says: ${text}`);
    }
    if (errors.length) failures.push(`${label}\n  ${errors.join('\n  ')}`);
    else console.log(`ok  ${label}`);
  }
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} screen(s) failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log('\nAll screens passed.');
