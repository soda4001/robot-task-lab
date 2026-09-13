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

export type RunStatus = 'ready' | 'running' | 'paused' | 'complete' | 'failed' | 'teleop';
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
  canGrip: boolean;
  nearbyBlock: ObjectId | null;
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
  isTeleop = false;
  elapsed = 0;
  activeIndex = -1;
  completed = 0;
  position: Point = { ...HOME };
  held: ObjectId | null = null;
  isClawClosed = false;
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
      position: new CANNON.Vec3(HOME.x, HOME.y, HOME.z),
    });
    // Left and right finger collision boxes
    this.gripper.addShape(
      new CANNON.Box(new CANNON.Vec3(0.02, 0.08, 0.06)),
      new CANNON.Vec3(-0.13, 0.035, 0),
    );
    this.gripper.addShape(
      new CANNON.Box(new CANNON.Vec3(0.02, 0.08, 0.06)),
      new CANNON.Vec3(0.13, 0.035, 0),
    );
    // Palm / motor collision box
    this.gripper.addShape(
      new CANNON.Box(new CANNON.Vec3(0.10, 0.06, 0.08)),
      new CANNON.Vec3(0, 0.175, 0),
    );
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

  startTeleop() {
    this.isTeleop = true;
    this.status = 'teleop';
    this.gripper.collisionFilterMask = -1;
    this.log('Direct Drive mode active. Control arm with keys or HUD.');
  }

  stopTeleop() {
    this.isTeleop = false;
    this.status = 'paused';
    this.gripper.collisionFilterMask = 0;
    this.gripper.velocity.setZero();
    this.log('Direct Drive mode paused.');
  }

  teleopMove(dx: number, dy: number, dz: number) {
    if (this.status !== 'teleop') return;

    let targetX = this.position.x + dx;
    let targetY = this.position.y + dy;
    let targetZ = this.position.z + dz;

    // Minimum base height from table
    targetY = Math.max(0.085, Math.min(1.2, targetY));

    if (this.held === null) {
      for (const id of Object.keys(COLORS) as ObjectId[]) {
        const body = this.bodies[id];
        const bx = body.position.x;
        const by = body.position.y;
        const bz = body.position.z;

        // Block bounding box
        const bMinX = bx - 0.09;
        const bMaxX = bx + 0.09;
        const bMinY = by - 0.09;
        const bMaxY = by + 0.09;
        const bMinZ = bz - 0.09;
        const bMaxZ = bz + 0.09;

        // Finger bounds:
        // Left finger X: [targetX - 0.171, targetX - 0.139]
        // Right finger X: [targetX + 0.139, targetX + 0.171]
        // Finger Y: [targetY - 0.045, targetY + 0.115]
        // Finger Z: [targetZ - 0.06, targetZ + 0.06]
        const fMinY = targetY - 0.045;
        const fMaxY = targetY + 0.115;
        const fMinZ = targetZ - 0.06;
        const fMaxZ = targetZ + 0.06;

        const isZOverlap = fMinZ < bMaxZ && fMaxZ > bMinZ;
        if (isZOverlap) {
          const leftOverlapX = targetX - 0.171 < bMaxX && targetX - 0.139 > bMinX;
          const rightOverlapX = targetX + 0.139 < bMaxX && targetX + 0.171 > bMinX;

          // 1. If centered over block: allow descending until palm meets block top (for grasping!)
          const isGraspAligned = Math.abs(targetX - bx) < 0.055 && Math.abs(targetZ - bz) < 0.065;

          if (isGraspAligned) {
            // Lower cleanly down to block center to grasp
            targetY = Math.max(targetY, bMaxY - 0.09);
          } else if (leftOverlapX || rightOverlapX) {
            if (fMinY < bMaxY && fMaxY > bMinY) {
              if (dy < 0 || this.position.y >= bMaxY + 0.04) {
                // Stopped on top of block
                targetY = Math.max(targetY, bMaxY + 0.045);
              } else {
                // Moving horizontally into side of block: physically push the block!
                const pushX = dx !== 0 ? dx : (rightOverlapX ? 0.02 : -0.02);
                const pushZ = dz !== 0 ? dz : 0;
                body.position.x += pushX;
                body.position.z += pushZ;
                body.velocity.x = pushX * 20;
                body.velocity.z = pushZ * 20;
                body.wakeUp();

                // Keep claw exactly on outer surface without penetrating
                const newBMinX = body.position.x - 0.09;
                const newBMaxX = body.position.x + 0.09;
                if (leftOverlapX) {
                  targetX = Math.min(targetX, newBMaxX + 0.171);
                } else if (rightOverlapX) {
                  targetX = Math.max(targetX, newBMinX - 0.171);
                }
              }
            }
          }

          // Palm collision with block top (stops motor base plunging into block)
          const pMinX = targetX - 0.1;
          const pMaxX = targetX + 0.1;
          const pMinY = targetY + 0.1;
          const pMinZ = targetZ - 0.08;
          const pMaxZ = targetZ + 0.08;
          if (pMinX < bMaxX && pMaxX > bMinX && pMinZ < bMaxZ && pMaxZ > bMinZ) {
            if (pMinY < bMaxY) {
              targetY = Math.max(targetY, bMaxY - 0.095);
            }
          }

          // Front/Back finger contact: push block in Z direction
          const clawMinX = targetX - 0.171;
          const clawMaxX = targetX + 0.171;
          if (clawMinX < bMaxX && clawMaxX > bMinX && fMinY < bMaxY && fMaxY > bMinY) {
            const isBetweenFingers = Math.abs(targetX - bx) <= 0.045;
            if (!isBetweenFingers) {
              if (targetZ < bz && targetZ + 0.06 > bMinZ) {
                const pushZ = dz > 0 ? dz : 0.02;
                body.position.z += pushZ;
                body.velocity.z = pushZ * 20;
                body.wakeUp();
                targetZ = Math.min(targetZ, body.position.z - 0.09 - 0.061);
              } else if (targetZ > bz && targetZ - 0.06 < bMaxZ) {
                const pushZ = dz < 0 ? dz : -0.02;
                body.position.z += pushZ;
                body.velocity.z = pushZ * 20;
                body.wakeUp();
                targetZ = Math.max(targetZ, body.position.z + 0.09 + 0.061);
              }
            }
          }
        }
      }
    } else {
      // While holding a block:
      targetY = Math.max(0.14, targetY);

      const heldBody = this.bodies[this.held];
      heldBody.position.set(targetX, targetY - 0.035, targetZ);
      heldBody.wakeUp();

      for (const id of Object.keys(COLORS) as ObjectId[]) {
        if (id === this.held) continue;
        const other = this.bodies[id];
        const vertDist = Math.abs(targetY - 0.035 - other.position.y);
        if (vertDist < 0.18) {
          const hDist = Math.hypot(targetX - other.position.x, targetZ - other.position.z);
          const minClearance = 0.185;
          if (hDist < minClearance && hDist > 0.001) {
            const nx = (targetX - other.position.x) / hDist;
            const nz = (targetZ - other.position.z) / hDist;
            const pushDist = (minClearance - hDist);
            // Physically push the other block away!
            other.position.x -= nx * pushDist;
            other.position.z -= nz * pushDist;
            other.velocity.x = -nx * pushDist * 20;
            other.velocity.z = -nz * pushDist * 20;
            other.wakeUp();

            targetX = other.position.x + nx * minClearance;
            targetZ = other.position.z + nz * minClearance;
            heldBody.position.set(targetX, targetY - 0.035, targetZ);
          }
        }
      }
    }

    const next = { x: targetX, y: targetY, z: targetZ };
    const distance = Math.hypot(
      next.x - SHOULDER.x,
      next.y + 0.2 - SHOULDER.y,
      next.z - SHOULDER.z,
    );
    if (distance <= 2.12) {
      this.position = next;
      this.gripper.position.set(next.x, next.y, next.z);
    }
  }

  teleopToggleGrip(): boolean {
    if (this.held !== null) {
      if (this.constraint) this.world.removeConstraint(this.constraint);
      this.constraint = null;
      const released = this.held;
      this.held = null;
      this.isClawClosed = false;
      this.log(`Released ${COLORS[released].name}.`);
      return false;
    }

    if (this.isClawClosed) {
      this.isClawClosed = false;
      this.log('Gripper opened.');
      return false;
    }

    let nearestId: ObjectId | null = null;
    let minDist = 0.32;
    for (const id of Object.keys(COLORS) as ObjectId[]) {
      const body = this.bodies[id];
      const d = body.position.distanceTo(this.gripper.position);
      if (d < minDist) {
        minDist = d;
        nearestId = id;
      }
    }
    if (nearestId) {
      const body = this.bodies[nearestId];
      body.wakeUp();
      // Snap block neatly centered between the gripper fingers to eliminate mesh clipping/overlapping
      body.position.set(
        this.gripper.position.x,
        this.gripper.position.y - 0.035,
        this.gripper.position.z,
      );
      body.quaternion.set(0, 0, 0, 1);
      body.velocity.setZero();
      body.angularVelocity.setZero();

      this.constraint = new CANNON.LockConstraint(this.gripper, body, { maxForce: 250 });
      this.constraint.collideConnected = false;
      this.world.addConstraint(this.constraint);
      this.held = nearestId;
      this.isClawClosed = true;
      this.log(`Grasped ${COLORS[nearestId].name}!`, 'success');
      return true;
    }

    this.isClawClosed = true;
    this.log('Gripper closed (empty air).');
    return true;
  }

  canGripBlock(): ObjectId | null {
    if (this.held !== null) return this.held;
    for (const id of Object.keys(COLORS) as ObjectId[]) {
      const body = this.bodies[id];
      if (body.position.distanceTo(this.gripper.position) < 0.32) {
        return id;
      }
    }
    return null;
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
    if (this.status === 'teleop') {
      this.elapsed += dt;
      this.gripper.velocity.set(
        (this.position.x - this.gripper.position.x) / dt,
        (this.position.y - this.gripper.position.y) / dt,
        (this.position.z - this.gripper.position.z) / dt,
      );
      this.world.step(dt);
      if (this.held !== null) {
        const heldBody = this.bodies[this.held];
        heldBody.position.set(
          this.gripper.position.x,
          this.gripper.position.y - 0.035,
          this.gripper.position.z,
        );
        heldBody.quaternion.set(0, 0, 0, 1);
        heldBody.velocity.setZero();
      }
      return;
    }
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
      this.isClawClosed = true;
    }
    if (phase.action === 'release') {
      if (this.constraint) this.world.removeConstraint(this.constraint);
      this.constraint = null;
      this.held = null;
      this.isClawClosed = false;
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
          : this.status === 'teleop'
            ? (this.held ? `Direct Drive: Holding ${COLORS[this.held].name}` : 'Direct Drive: Manual Control')
            : this.status === 'complete'
              ? 'Run complete'
              : this.status === 'failed'
                ? 'Run stopped'
                : (this.phases[this.phaseIndex]?.name ?? 'Validating'),
      completed: this.completed,
      grip: this.held !== null || this.isClawClosed,
      canGrip: this.canGripBlock() !== null,
      nearbyBlock: this.canGripBlock(),
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
