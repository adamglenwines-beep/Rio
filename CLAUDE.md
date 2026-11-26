# Notes for Claude sessions

**Read `DESIGN.md` first**: it is the shared vision for this game. Keep it up to date
when a design decision changes.

## Workflow
- Work on a **dev branch**. Merge into `main` only when the user explicitly approves a
  round. `main` is published live at https://adamglenwines-beep.github.io/Rio/
  (GitHub Pages, repo root), so it must always be an approved version.
- Commit and push after each step of a round, so any step can be rolled back.
- For visual changes, take before/after screenshots (postcard, aerial, and close-ups
  relevant to the change) and keep comparison images in `docs/progress/`.
- At the end of a round, report what got worse and what you'd tune next.
- The user is not a professional developer: explain clearly, and ask before acting when
  a request is phrased as a question.

## Code
- Plain ES modules, Three.js from a CDN via the import map in `index.html`. There is no
  build step. All paths must be relative (the site lives under `/Rio/`).
- Every tunable number goes in `src/config.js`.
- It must stay phone- and tablet-friendly: instanced or merged meshes, no per-object
  draw calls, and watch growth-step and rebuild times.
