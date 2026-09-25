// Browser smoke test for the built portal: opens every screen in Chromium at phone and desktop
// widths and fails on uncaught errors, console errors, failed content requests, a screen that
// renders nothing, or horizontal page overflow at 375px.
//
//   BASE=http://localhost:4173 node scripts/smoke.mjs
import { chromium } from 'playwright';

const BASE = (process.env.BASE ?? 'http://localhost:4173').replace(/\/$/, '');
const ROUTES = ['/', '/setup', '/truefalse', '/analytics', '/settings', '/review', '/formulas', '/sense', '/games'];
// Sections with a Start button that can be played from the keyboard.
const PLAYABLE = [
  { route: '/truefalse', buttons: [/^\s*Start\s*$/] },
  { route: '/formulas', buttons: [/^\s*Start\s*$/] },
  { route: '/sense', buttons: [/^\s*Start\s*$/] },
  // Notes games: the auto-pick Play button, then the arc's Begin.
  { route: '/games', buttons: [/^\s*Play\s*$/, /^\s*Begin\s*$/] },
];
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 800 },
  { name: 'desktop', width: 1280, height: 900 },
];
// Noise that isn't an app failure.
const IGNORE = [/favicon/i, /Download the React DevTools/i];

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

  for (const route of ROUTES) {
    errors = [];
    const label = `${vp.name} #${route}`;
    try {
      await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle', timeout: 30000 });
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
  for (const { route, buttons } of PLAYABLE) {
    errors = [];
    const label = `${vp.name} play #${route}`;
    try {
      await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1500);
      let started = true;
      for (const name of buttons) {
        const button = page.getByRole('button', { name }).first();
        if ((await button.count()) === 0 || !(await button.isEnabled())) {
          started = false;
          break;
        }
        await button.click();
        await page.waitForTimeout(800);
      }
      if (!started) {
        console.log(`--  ${label} (nothing to start; content not generated yet?)`);
        continue;
      }
      for (let i = 0; i < 12; i++) {
        for (const key of [' ', '1', 'Enter']) {
          await page.keyboard.press(key);
          await page.waitForTimeout(250);
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
  await context.close();
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} screen(s) failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log('\nAll screens passed.');
