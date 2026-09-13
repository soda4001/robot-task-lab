# Robot Task Lab

Independent project at `D:\robot-task-lab`. The neighboring Physical AI Studio
is a reference only; this project does not import or modify it.

The owner is a solo builder targeting a global, monetizable web product.
Prefer polished, complete lab workflows over adding unrelated robot types.
Speak Korean with the owner; keep product UI in English.

## Engineering

- React + TypeScript + Vite, with locally bundled dependencies and fonts.
- `model.ts` defines the portable, validated project contract.
- `simulation.ts` must remain runnable without DOM/WebGL. Batch tests use it.
- `viewport.ts` renders state; validation must never depend on animation completion alone.
- Keep 120 Hz physical simulation independent of display frame rate.
- Run `npm test`, `npm run build`, and browser checks after behavior changes.
- Browser tests expect Chrome and a local server at port 5180.
- Keep camera framing clear of title and transport controls across small screens.
- Preserve import limits and schema validation for external project files.

## Product Truth

This is an educational manipulation workbench. The arm uses kinematic IK;
blocks use cannon-es rigid-body physics. Grasping is a constrained attachment.
No motor dynamics, collision-aware planning, vision, LLM, or hardware driver is included.
Python export is explicitly dry-run. Do not add fake hardware/AI labels or
nonfunctional paid buttons. Pricing in `docs/PRODUCT_DIRECTION.md` is a hypothesis.
