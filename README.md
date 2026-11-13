# FRM Part II Study Portal

A mobile-first, offline-capable practice portal for FRM Part II, served at
https://study.aumparekh.com.

- `content/` — the question banks as JSON (one file per subject, plus `content/mocks/`).
- `web/` — the React + Vite portal that reads those files at runtime.
- `PORTAL_PLAN.md` — the build plan.

## Content notice

Questions with ids containing `-QB-` or `-WB-` are quoted as printed from the
question banks and workbooks in `data/build-inputs/question-banks/`, used with
the providers' permission; each carries its source tag. The other questions,
solutions, and explanations in `content/` are the author's own reworded study
notes. Chapter names and learning-objective wording follow the GARP 2026 FRM
Part II learning objectives. This project is not affiliated with, endorsed by,
or produced by GARP. "FRM" and "Financial Risk Manager" are trademarks of GARP.

## Run locally

```bash
cd web
npm install
npm run dev
```

Open the printed URL (use `--host` on your LAN to test on a phone). The dev
server serves `../content` at `/content`, and `npm run build` copies it into
`web/dist/content`.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds `web/` and
publishes `web/dist` to GitHub Pages. The custom domain is set by
`web/public/CNAME`.
