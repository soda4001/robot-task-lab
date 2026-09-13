import * as CANNON from 'cannon-es';
import {
  COLORS,
  MISSIONS,
  seededPositions,
  type ObjectId,
  type Point,
  type Project,
  type Step,
} from './model';

export const HOME: Point = { x: 0.05, y: 0.82, z: 0.27 };
export const SHOULDER: Point = { x: -1.05, y: 0.4, z: -0.19 };

export type ServoAngles = {
  base: number;
  shoulder: number;
  elbow: number;
  gripper: number;
};

export function computeServoAngles(position: Point, grip: boolean): ServoAngles {
  const start = SHOULDER;
  const end = { x: position.x, y: position.y + 0.22, z: position.z };
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const h = Math.hypot(dx, dz);
  const v = end.y - start.y;
  const distance = Math.min(2.099, Math.max(0.201, Math.hypot(h, v)));
  const a = 0.95;
  const b = 1.15;
  const shoulderCos = Math.min(1, Math.max(-1, (a * a + distance * distance - b * b) / (2 * a * distance)));
  const shoulderAngleRad = Math.atan2(v, h) + Math.acos(shoulderCos);
  const elbowCos = Math.min(1, Math.max(-1, (a * a + b * b - distance * distance) / (2 * a * b)));
  const elbowAngleRad = Math.PI - Math.acos(elbowCos);

  const baseDeg = Math.round(90 - Math.atan2(dz, dx) * (180 / Math.PI));
  const shoulderDeg = Math.round(shoulderAngleRad * (180 / Math.PI));
  const elbowDeg = Math.round(elbowAngleRad * (180 / Math.PI));
  const gripperDeg = grip ? 35 : 90;

  return {
    base: Math.min(180, Math.max(0, baseDeg)),
    shoulder: Math.min(180, Math.max(0, shoulderDeg)),
    elbow: Math.min(180, Math.max(0, elbowDeg)),
    gripper: gripperDeg,
  };
}

export type RunStatus = 'ready' | 'running' | 'paused' | 'complete' | 'failed';
export type LogEntry = { time: number; message: string; kind: 'info' | 'success' | 'error' };
export type Check = { objectId: ObjectId; passed: boolean; errorMm: number; target: string };
export type RunResult = {
  id: string;
  mission: string;
  seed: number;
  duration: number;
  passed: boolean;
  checks: Check[];
  steps: number;
  completedAt: string;
};
export type Snapshot = {
  status: RunStatus;
  elapsed: number;
  activeIndex: number;
  phase: string;
  completed: number;
  grip: boolean;
  position: Point;
  objects: Record<ObjectId, Point>;
  logs: LogEntry[];
  result: RunResult | null;
};
type Phase = { name: string; duration: number; target?: Point; action?: 'grab' | 'release' };

export class Simulation {
  world: CANNON.World;
  bodies = {} as Record<ObjectId, CANNON.Body>;
  gripper: CANNON.Body;
  project: Project;
  status: RunStatus = 'ready';
  elapsed = 0;
  activeIndex = -1;
  completed = 0;
  position: Point = { ...HOME };
  held: ObjectId | null = null;
  logs: LogEntry[] = [];
  result: RunResult | null = null;
  private constraint: CANNON.LockConstraint | null = null;
  private phases: Phase[] = [];
  private phaseIndex = 0;
  private phaseElapsed = 0;
  private phaseFrom: Point = { ...HOME };
  private steps: Step[] = [];
  private layers: Record<string, number> = {};
  private finalSettle = 0;

  constructor(project: Project) {
    this.project = structuredClone(project);
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0), allowSleep: true });
    (this.world.solver as CANNON.GSSolver).iterations = 25;
    this.world.defaultContactMaterial.friction = 0.65;
    this.world.defaultContactMaterial.restitution = 0.02;
    this.world.addBody(
      new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(1.9, 0.06, 1.25)),
        position: new CANNON.Vec3(0, -0.06, 0),
      }),
    );
    const positions = seededPositions(project.seed);
    for (const id of Object.keys(COLORS) as ObjectId[]) {
      const p = positions[id];
      const body = new CANNON.Body({
        mass: 0.15,
        shape: new CANNON.Box(new CANNON.Vec3(0.09, 0.09, 0.09)),
        position: new CANNON.Vec3(p.x, p.y, p.z),
        linearDamping: 0.45,
        angularDamping: 0.8,
      });
      body.sleepTimeLimit = 0.5;
      this.bodies[id] = body;
      this.world.addBody(body);
    }
    if (project.mission === 'sort') {
      for (const target of MISSIONS.sort.targets) {
        const edge = target.size / 2;
        for (const [dx, dz, sx, sz] of [
          [-edge, 0, 0.014, edge],
          [edge, 0, 0.014, edge],
          [0, -edge, edge, 0.014],
          [0, edge, edge, 0.014],
        ]) {
          this.world.addBody(
            new CANNON.Body({
              mass: 0,
              shape: new CANNON.Box(new CANNON.Vec3(sx, 0.035, sz)),
              position: new CANNON.Vec3(target.x + dx, 0.035, target.z + dz),
            }),
          );
        }
      }
    }
    this.gripper = new CANNON.Body({
      type: CANNON.Body.KINEMATIC,
      mass: 0,
      collisionFilterMask: 0,
      shape: new CANNON.Sphere(0.01),
      position: new CANNON.Vec3(HOME.x, HOME.y, HOME.z),
    });
    this.world.addBody(this.gripper);
    for (let i = 0; i < 30; i++) this.world.step(1 / 120);
    this.log('Scene initialized. All systems ready.');
  }

  private log(message: string, kind: LogEntry['kind'] = 'info') {
    this.logs = [...this.logs.slice(-79), { time: this.elapsed, message, kind }];
  }

  start() {
    if (this.status === 'paused') {
      this.status = 'running';
      this.log('Run resumed.');
      return;
    }
    if (this.status !== 'ready') return;
    this.steps = this.project.steps.filter((s) => s.enabled);
    if (this.steps.length === 0) {
      this.log('Add or enable a task before running.', 'error');
      return;
    }
    this.status = 'running';
    this.log(`Run started. ${this.steps.length} tasks queued.`);
    this.nextTask();
  }

  pause() {
    if (this.status === 'running') {
      this.status = 'paused';
      this.log('Run paused.');
    }
  }

  stepTask() {
    if (this.status === 'ready' || this.status === 'paused') {
      this.start();
      const starting = this.activeIndex;
      for (let i = 0; i < 12000 && (this.status as RunStatus) === 'running'; i++) {
        this.tick(1 / 120);
        if (this.activeIndex !== starting) {
          this.pause();
          break;
        }
      }
    }
  }

  private nextTask() {
    this.activeIndex++;
    if (this.activeIndex >= this.steps.length) {
      this.phases = [{ name: 'Returning home', duration: 1.2, target: { ...HOME } }];
      this.phaseIndex = 0;
      this.phaseElapsed = 0;
      this.phaseFrom = { ...this.position };
      this.finalSettle = 0;
      return;
    }
    const step = this.steps[this.activeIndex];
    const body = this.bodies[step.objectId];
    const target = MISSIONS[this.project.mission].targets.find((t) => t.id === step.targetId);
    if (!target) {
      this.fail('Destination is missing.');
      return;
    }
    const layer = this.project.mission === 'stack' ? (this.layers[target.id] ?? 0) : 0;
    const place = {
      x: target.x + this.project.placementOffset,
      y: 0.094 + layer * 0.18,
      z: target.z,
    };
    const pick = { x: body.position.x, y: body.position.y, z: body.position.z };
    const high = Math.max(this.project.liftHeight, place.y + 0.28);
    this.phases = [
      { name: 'Approaching', duration: 0.9, target: { ...pick, y: high } },
      { name: 'Lowering gripper', duration: 0.65, target: pick },
      { name: 'Grasping', duration: 0.28, action: 'grab' },
      { name: 'Lifting', duration: 0.7, target: { ...pick, y: high } },
      { name: 'Transferring', duration: 1.25, target: { ...place, y: high } },
      { name: 'Placing', duration: 0.7, target: place },
      { name: 'Releasing', duration: 0.3, action: 'release' },
      { name: 'Retracting', duration: 0.65, target: { ...place, y: high } },
    ];
    this.phaseIndex = 0;
    this.phaseElapsed = 0;
    this.phaseFrom = { ...this.position };
    this.layers[target.id] = layer + 1;
    this.log(`${COLORS[step.objectId].name} > ${target.name}`);
  }

  private fail(message: string) {
    this.status = 'failed';
    this.gripper.velocity.setZero();
    this.log(message, 'error');
  }

  tick(dt: number) {
    if (this.status !== 'running') return;
    this.elapsed += dt;
    const phase = this.phases[this.phaseIndex];
    if (!phase) {
      this.gripper.velocity.setZero();
      this.world.step(dt);
      this.finalSettle += dt;
      if (this.finalSettle >= 1.2) this.finish();
      return;
    }
    this.phaseElapsed += dt;
    const ratio = Math.min(1, this.phaseElapsed / phase.duration);
    const eased = ratio * ratio * (3 - 2 * ratio);
    if (phase.target) {
      const next = {
        x: this.phaseFrom.x + (phase.target.x - this.phaseFrom.x) * eased,
        y: this.phaseFrom.y + (phase.target.y - this.phaseFrom.y) * eased,
        z: this.phaseFrom.z + (phase.target.z - this.phaseFrom.z) * eased,
      };
      const distance = Math.hypot(
        next.x - SHOULDER.x,
        next.y + 0.2 - SHOULDER.y,
        next.z - SHOULDER.z,
      );
      if (distance > 2.12) {
        this.fail('Target is outside the arm workspace.');
        return;
      }
      this.gripper.velocity.set(
        (next.x - this.gripper.position.x) / dt,
        (next.y - this.gripper.position.y) / dt,
        (next.z - this.gripper.position.z) / dt,
      );
      this.position = next;
    } else this.gripper.velocity.setZero();
    this.world.step(dt);
    if (ratio < 1) return;
    if (phase.action === 'grab') {
      const id = this.steps[this.activeIndex].objectId;
      const body = this.bodies[id];
      if (body.position.distanceTo(this.gripper.position) > 0.065) {
        this.fail('Grasp missed: object moved out of tolerance.');
        return;
      }
      body.wakeUp();
      this.constraint = new CANNON.LockConstraint(this.gripper, body, { maxForce: 150 });
      this.constraint.collideConnected = false;
      this.world.addConstraint(this.constraint);
      this.held = id;
    }
    if (phase.action === 'release') {
      if (this.constraint) this.world.removeConstraint(this.constraint);
      this.constraint = null;
      this.held = null;
    }
    this.phaseIndex++;
    this.phaseElapsed = 0;
    this.phaseFrom = { ...this.position };
    if (this.phaseIndex >= this.phases.length && this.activeIndex < this.steps.length) {
      this.completed++;
      this.log(`Task ${this.completed} completed.`, 'success');
      this.nextTask();
    }
  }

  private finish() {
    const checks = this.evaluate();
    const passed = checks.every((c) => c.passed);
    this.status = 'complete';
    this.result = {
      id: crypto.randomUUID(),
      mission: this.project.mission,
      seed: this.project.seed,
      duration: this.elapsed,
      passed,
      checks,
      steps: this.completed,
      completedAt: new Date().toISOString(),
    };
    this.log(
      passed
        ? 'Validation passed. All objects are on target.'
        : 'Validation failed. Check destination assignments and placement offset.',
      passed ? 'success' : 'error',
    );
  }

  evaluate(): Check[] {
    const ids = Object.keys(COLORS) as ObjectId[];
    return ids.map((id, i) => {
      const body = this.bodies[id];
      const target =
        MISSIONS[this.project.mission].targets[this.project.mission === 'stack' ? 0 : i];
      const error = Math.hypot(body.position.x - target.x, body.position.z - target.z);
      const tol =
        this.project.mission === 'sort'
          ? 0.115
          : this.project.mission === 'precision'
            ? 0.035
            : 0.05;
      let heightOk = Math.abs(body.position.y - 0.09) < 0.04;
      if (this.project.mission === 'stack') {
        const sorted = ids
          .map((key) => ({ key, y: this.bodies[key].position.y }))
          .sort((a, b) => a.y - b.y);
        const layer = sorted.findIndex((item) => item.key === id);
        heightOk = Math.abs(body.position.y - (0.09 + layer * 0.18)) < 0.045;
      }
      return {
        objectId: id,
        passed: error < tol && heightOk,
        errorMm: Math.round(error * 1000),
        target: target.name,
      };
    });
  }

  snapshot(): Snapshot {
    return {
      status: this.status,
      elapsed: this.elapsed,
      activeIndex: this.activeIndex,
      phase:
        this.status === 'ready'
          ? 'Ready to run'
          : this.status === 'complete'
            ? 'Run complete'
            : this.status === 'failed'
              ? 'Run stopped'
              : (this.phases[this.phaseIndex]?.name ?? 'Validating'),
      completed: this.completed,
      grip: this.held !== null,
      position: { ...this.position },
      objects: Object.fromEntries(
        (Object.keys(COLORS) as ObjectId[]).map((id) => [
          id,
          {
            x: this.bodies[id].position.x,
            y: this.bodies[id].position.y,
            z: this.bodies[id].position.z,
          },
        ]),
      ) as Record<ObjectId, Point>,
      logs: this.logs,
      result: this.result,
    };
  }
}

export function benchmark(project: Project, count = 10): RunResult[] {
  const results: RunResult[] = [];
  for (let i = 0; i < count; i++) {
    const sim = new Simulation({ ...project, seed: ((project.seed + i * 997 - 1) % 999999) + 1 });
    sim.start();
    if (sim.status !== 'running') throw new Error('Enable at least one task before testing.');
    for (let tick = 0; tick < 24000 && sim.status === 'running'; tick++) sim.tick(1 / 120);
    results.push(
      sim.result ?? {
        id: crypto.randomUUID(),
        mission: project.mission,
        seed: sim.project.seed,
        duration: sim.elapsed,
        passed: false,
        checks: sim.evaluate(),
        steps: sim.completed,
        completedAt: new Date().toISOString(),
      },
    );
  }
  return results;
}
