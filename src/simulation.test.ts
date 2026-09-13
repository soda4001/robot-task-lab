import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createProject, parseProject, seededPositions, toPython } from './model';
import { Simulation, benchmark } from './simulation';

describe('physical task validation', () => {
  it.each(['sort', 'precision', 'stack'] as const)(
    '%s completes with all blocks in their targets',
    (mission) => {
      const results = benchmark(createProject(mission), 3);
      for (const result of results) {
        expect(result.passed, JSON.stringify(result)).toBe(true);
        expect(result.steps).toBe(3);
        expect(result.checks).toHaveLength(3);
      }
    },
  );
  it('rejects wrong destinations instead of awarding success for animation completion', () => {
    const project = createProject();
    [project.steps[0].targetId, project.steps[1].targetId] = [
      project.steps[1].targetId,
      project.steps[0].targetId,
    ];
    const [result] = benchmark(project, 1);
    expect(result.passed).toBe(false);
    expect(result.checks[0].passed).toBe(false);
  });
  it('detects precision offsets', () => {
    const project = createProject('precision');
    project.placementOffset = 0.08;
    const [result] = benchmark(project, 1);
    expect(result.passed).toBe(false);
    expect(result.checks.every((check) => check.errorMm > 35)).toBe(true);
  });
  it('does not pass a task sequence that skips an object', () => {
    const project = createProject();
    project.steps[1].enabled = false;
    expect(benchmark(project, 1)[0].passed).toBe(false);
  });
  it('pauses the physics clock and can resume', () => {
    const sim = new Simulation(createProject());
    sim.start();
    for (let i = 0; i < 240; i++) sim.tick(1 / 120);
    sim.pause();
    const before = sim.snapshot();
    for (let i = 0; i < 240; i++) sim.tick(1 / 120);
    expect(sim.snapshot()).toEqual(before);
    sim.start();
    sim.tick(1 / 120);
    expect(sim.elapsed).toBeGreaterThan(before.elapsed);
  });
  it('single-steps one full task and pauses before the next', () => {
    const sim = new Simulation(createProject());
    sim.stepTask();
    expect(sim.completed).toBe(1);
    expect(sim.status).toBe('paused');
    expect(sim.bodies.coral.position.z).toBeCloseTo(-0.57, 1);
  });
  it('supports direct drive teleoperation mode with kinematic control and grasping', () => {
    const sim = new Simulation(createProject());
    sim.startTeleop();
    expect(sim.status).toBe('teleop');
    expect(sim.isTeleop).toBe(true);

    const initialPos = { ...sim.position };
    sim.teleopMove(0.1, 0.05, -0.1);
    expect(sim.position.x).toBeCloseTo(initialPos.x + 0.1, 3);
    expect(sim.position.y).toBeCloseTo(initialPos.y + 0.05, 3);
    expect(sim.position.z).toBeCloseTo(initialPos.z - 0.1, 3);

    for (let i = 0; i < 30; i++) sim.tick(1 / 120);
    expect(sim.gripper.position.x).toBeCloseTo(sim.position.x, 2);

    // Move directly above coral block and test grasp
    const coralPos = sim.bodies.coral.position;
    sim.position = { x: coralPos.x, y: coralPos.y + 0.05, z: coralPos.z };
    for (let i = 0; i < 30; i++) sim.tick(1 / 120);

    const grasped = sim.teleopToggleGrip();
    expect(grasped).toBe(true);
    expect(sim.held).toBe('coral');

    // Releasing grip
    const released = sim.teleopToggleGrip();
    expect(released).toBe(false);
    expect(sim.held).toBeNull();

    sim.stopTeleop();
    expect(sim.status).toBe('paused');
    expect(sim.isTeleop).toBe(false);
  });
});

describe('portable project format', () => {
  it('round trips a saved project', () => {
    const project = createProject();
    expect(parseProject(JSON.stringify(project))).toEqual(project);
  });
  it('rejects foreign target IDs, invalid physics values and duplicate step IDs', () => {
    const p = createProject();
    expect(() => parseProject(JSON.stringify({ ...p, liftHeight: -1 }))).toThrow();
    expect(() =>
      parseProject(JSON.stringify({ ...p, steps: [{ ...p.steps[0], targetId: 'unknown' }] })),
    ).toThrow();
    expect(() => parseProject(JSON.stringify({ ...p, steps: [p.steps[0], p.steps[0]] }))).toThrow();
  });
  it('generates deterministic but varying object layouts', () => {
    expect(seededPositions(42)).toEqual(seededPositions(42));
    expect(seededPositions(42)).not.toEqual(seededPositions(43));
  });
  it('exports an explicitly dry-run Python adapter', () => {
    const python = toPython(createProject());
    expect(python).toContain('not a hardware driver');
    expect(python).toContain('class RobotAdapter');
    expect(python).toContain('if __name__');
  });
  it('executes the Python export with quotes, slashes and Unicode in the project name', () => {
    const project = createProject('stack');
    project.name = 'Test "name" / \\folder / \uD55C\uAE00';
    const output = execFileSync('python', ['-c', toPython(project)], { encoding: 'utf8' });
    expect(output).toContain('PICK coral');
    expect(output).toContain('y=0.450');
    expect(output.trim().split('\n')).toHaveLength(3);
  });
});
