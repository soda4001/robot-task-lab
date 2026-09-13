# Robot Task Lab

A focused browser workbench for learning and testing robot manipulation.

Korean quick start: [실행과 사용](docs/QUICKSTART.ko.md).

Build a pick-and-place sequence, execute it in a 3D workcell, and validate the
final physical state. No account, cloud API key, or backend is required.

## Run

Windows: double-click `start-lab.cmd`.

Requires Node.js 22+ and a browser with WebGL2. The first install needs internet;
fonts, libraries, physics, and project storage then run locally.

```powershell
cd D:\robot-task-lab
npm ci
npm run dev -- --port 5180
```

Open http://127.0.0.1:5180. Vite selects the next port when one is occupied.

## Workbench

- Three complete labs: color sorting, precision placement, and stacking.
- Editable, reorderable, individually enabled pick-and-place tasks.
- Deterministic layout seeds, configurable clearance and placement offset.
- Run, pause, resume, reset, and single-task stepping at four playback speeds.
- Orbit camera, top/front views, grid, motion paths, object inspection, PNG capture.
- Actual rigid-body gravity, table/tray collision, settling, and stack validation.
- Ten-layout batch tests in a Web Worker; CSV result export.
- Local autosave, undo/redo, schema-validated JSON import/export.
- Executable Python dry-run recipe export with an explicit adapter boundary.
- Responsive scene/program/inspector views on small screens.

Each run checks all three mission objects against their intended destinations,
including tasks that were skipped or assigned to the wrong target. Sorting uses
115 mm planar tolerance, precision placement 35 mm, and stacking 50 mm plus
individual layer-height checks. Coordinates use meters and Y-up.

## Scope

The arm uses analytical two-link inverse kinematics and prescribed motion.
Blocks use cannon-es rigid-body dynamics at 120 Hz. Grasping uses a force-limited
constraint attachment, not a contact-based gripper solver. Robot links do not
collide with the environment. The app does not model motor torque, cameras,
perception, motion planning, or reinforcement learning.

Recipes are deterministic task generation, not an AI/LLM copilot. Python export
prints the task plan; it does not connect to hardware. No ROS2, Arduino, or
sim-to-real compatibility is claimed. This build is a local product preview;
checkout and licensing are not implemented.

## Validate

```powershell
npm test
npm run build
# Start the dev server on port 5180 first. Chrome must be installed.
npm run test:e2e
```

The core tests exercise success and failure states, paused physics, task stepping,
seed reproducibility, and project validation. Browser tests exercise rendering,
real runs, downloads, import, persistence, batch validation, and responsive UI.
Screenshots are generated into `docs/`.

## Structure

| File                        | Responsibility                                             |
| --------------------------- | ---------------------------------------------------------- |
| `src/model.ts`              | Versioned project schema, lab definitions, recipes, export |
| `src/simulation.ts`         | Headless physics, task execution, validation               |
| `src/viewport.ts`           | Three.js robot model, cameras, picking and rendering       |
| `src/benchmark.worker.ts`   | Isolated batch evaluation                                  |
| `src/App.tsx`               | Workbench UI, local persistence and interaction            |
| `src/styles.css`            | Desktop and mobile layouts                                 |
| `docs/PRODUCT_DIRECTION.md` | Product judgment and paid-product scope (Korean)           |

Built with React, TypeScript, Three.js, cannon-es, Zod, and Lucide. Fonts are
bundled DM Sans and IBM Plex Mono. All workcell geometry is created in this
project. Refer to installed dependency packages for their respective licenses.

## Build

`npm run build` creates `dist/`, which can be served by a static host. No server
secrets or API calls are needed. `npm run preview -- --port 5180` serves the build
locally. `index.html` must be served over HTTP rather than opened directly.

This project is independent of `D:\physical-ai-studio`.
