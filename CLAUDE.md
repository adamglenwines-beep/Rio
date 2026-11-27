# Notes for Claude sessions

**Read `DESIGN.md` first**: it is the shared vision for this game. Keep it up to date
when a design decision changes.

## Workflow
- Work on a **dev branch** during a round. Commit and push after each step, so any step
  can be rolled back.
- **At the end of every round, publish it — don't wait for approval:**
  1. Bump the label in `src/version.js` (e.g. `v0.6 · Quarry`). It shows in the title
     pill, top left of the game.
  2. Merge the dev branch into `main` and push `main`.
  3. Wait for the GitHub Pages deployment ("pages build and deployment" run) for that
     commit to finish successfully.
  4. Give the user the live link https://adamglenwines-beep.github.io/Rio/ and the
     version label they should see (a hard refresh may be needed if they see the old one).
- If the user dislikes a round, they can ask to roll `main` back to an earlier version.
- **Never delete sections from `PROGRESS.md`.** When a run finishes, move its notes to an
  "Earlier runs" section (or to `docs/progress-archive/`); don't overwrite them.
- For visual changes, take before/after screenshots (postcard, aerial, and close-ups
  relevant to the change) and keep comparison images in `docs/progress/`.
- At the end of a round, report what got worse and what you'd tune next.
- The user is not a professional developer: explain clearly, and ask before acting when
  a request is phrased as a question.

## Code
- Plain ES modules, Three.js from a CDN via the import map in `index.html`. There is no
  build step. All paths must be relative (the site lives under `/Rio/`).
- Every tunable number goes in `src/config.js`.
- **PC first:** develop and test for a desktop browser with mouse and keyboard. Don't
  spend effort on phone/touch layouts or tablet performance for now, and don't test on
  phone-sized viewports or with CPU throttling as a "tablet estimate". Don't deliberately
  break touch either.
- Keep **input handling separate from game logic** (input lives in `ui.js`/`camera.js`
  and calls game APIs; game modules never read pointer or keyboard events), so a tablet
  port later only needs new input code.
- Stay efficient anyway: instanced or merged meshes, no per-object draw calls, and watch
  growth-step and rebuild times on desktop.
