import { z } from 'zod';

export const COLORS = {
  coral: { name: 'Coral block', hex: '#e96d5b', ink: '#b44838' },
  mint: { name: 'Mint block', hex: '#50b5a0', ink: '#217e6c' },
  blue: { name: 'Blue block', hex: '#639dda', ink: '#346fae' },
} as const;
export type ObjectId = keyof typeof COLORS;
export type MissionId = 'sort' | 'precision' | 'stack';
export type Point = { x: number; y: number; z: number };
export type Target = {
  id: string;
  name: string;
  x: number;
  z: number;
  color: string;
  size: number;
};
export type Mission = {
  id: MissionId;
  title: string;
  label: string;
  description: string;
  difficulty: string;
  targets: Target[];
};

export const MISSIONS: Record<MissionId, Mission> = {
  sort: {
    id: 'sort',
    title: 'Color sorting',
    label: '01',
    difficulty: 'Foundation',
    description: 'Three blocks. Three matching trays.',
    targets: [
      {
        id: 'coral-tray',
        name: 'Coral tray',
        x: -0.18,
        z: -0.57,
        color: COLORS.coral.hex,
        size: 0.42,
      },
      { id: 'mint-tray', name: 'Mint tray', x: 0.38, z: -0.57, color: COLORS.mint.hex, size: 0.42 },
      { id: 'blue-tray', name: 'Blue tray', x: 0.94, z: -0.57, color: COLORS.blue.hex, size: 0.42 },
    ],
  },
  precision: {
    id: 'precision',
    title: 'Precision placement',
    label: '02',
    difficulty: 'Intermediate',
    description: 'A tighter fit. A smaller margin.',
    targets: [
      { id: 'coral-slot', name: 'Slot A', x: -0.12, z: -0.57, color: COLORS.coral.hex, size: 0.25 },
      { id: 'mint-slot', name: 'Slot B', x: 0.38, z: -0.35, color: COLORS.mint.hex, size: 0.25 },
      { id: 'blue-slot', name: 'Slot C', x: 0.88, z: -0.57, color: COLORS.blue.hex, size: 0.25 },
    ],
  },
  stack: {
    id: 'stack',
    title: 'Build a tower',
    label: '03',
    difficulty: 'Advanced',
    description: 'One base. Three balanced layers.',
    targets: [{ id: 'tower', name: 'Tower base', x: 0.48, z: -0.35, color: '#dfb74f', size: 0.36 }],
  },
};

const stepSchema = z.object({
  id: z.string().min(1).max(80),
  objectId: z.enum(['coral', 'mint', 'blue']),
  targetId: z.string().min(1).max(40),
  enabled: z.boolean(),
});
export const projectSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(64),
    mission: z.enum(['sort', 'precision', 'stack']),
    seed: z.number().int().min(1).max(999999),
    liftHeight: z.number().min(0.42).max(1.05),
    placementOffset: z.number().min(-0.12).max(0.12),
    steps: z.array(stepSchema).max(12),
  })
  .superRefine((p, ctx) => {
    const targets = new Set(MISSIONS[p.mission].targets.map((t) => t.id));
    const ids = new Set<string>();
    p.steps.forEach((step, i) => {
      if (!targets.has(step.targetId))
        ctx.addIssue({
          code: 'custom',
          message: 'Unknown destination for this mission',
          path: ['steps', i, 'targetId'],
        });
      if (ids.has(step.id))
        ctx.addIssue({ code: 'custom', message: 'Duplicate step ID', path: ['steps', i, 'id'] });
      ids.add(step.id);
    });
  });
export type Project = z.infer<typeof projectSchema>;
export type Step = Project['steps'][number];

export function createProject(mission: MissionId = 'sort'): Project {
  return {
    version: 1,
    name: `${MISSIONS[mission].title} / Untitled`,
    mission,
    seed: 42,
    liftHeight: 0.75,
    placementOffset: 0,
    steps: (Object.keys(COLORS) as ObjectId[]).map((objectId, i) => ({
      id: `step-${i + 1}`,
      objectId,
      enabled: true,
      targetId: MISSIONS[mission].targets[mission === 'stack' ? 0 : i].id,
    })),
  };
}

export function parseProject(text: string): Project {
  if (text.length > 100_000) throw new Error('Project exceeds the 100 KB limit.');
  const result = projectSchema.safeParse(JSON.parse(text));
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? 'Invalid project file.');
  return result.data;
}

export function seededPositions(seed: number): Record<ObjectId, Point> {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return {
    coral: { x: -0.49 + random() * 0.18, y: 0.1, z: 0.4 + random() * 0.22 },
    mint: { x: 0.05 + random() * 0.18, y: 0.1, z: 0.57 + random() * 0.22 },
    blue: { x: 0.59 + random() * 0.18, y: 0.1, z: 0.35 + random() * 0.22 },
  };
}

export function compileRecipe(
  mission: MissionId,
  order: 'left-to-right' | 'right-to-left' | 'blue-first',
): Step[] {
  const steps = createProject(mission).steps;
  if (order === 'right-to-left') return steps.reverse();
  if (order === 'blue-first') return [steps[2], steps[0], steps[1]];
  return steps;
}

export function toPython(project: Project): string {
  const data = JSON.stringify(project, null, 2);
  return `"""Robot Task Lab: portable task recipe.

Run with Python 3.10+: python robot_task.py
This is a dry-run recipe, not a hardware driver.
Implement RobotAdapter methods for a specific robot and coordinate frame.
Coordinates are in meters. Axes: X right, Y up, Z forward.
"""
import json
from dataclasses import dataclass

PROJECT = json.loads(${JSON.stringify(data)})
TARGETS = json.loads(${JSON.stringify(JSON.stringify(MISSIONS[project.mission].targets))})

@dataclass
class RobotAdapter:
    def pick_and_place(self, object_name, target, layer, lift_height, offset):
        print(f"PICK {object_name}; PLACE {target['name']} "
              f"at x={target['x'] + offset:.3f}, "
              f"y={0.09 + layer * 0.18:.3f}, z={target['z']:.3f}; "
              f"clearance={lift_height:.2f}m")

def run(robot):
    targets = {target['id']: target for target in TARGETS}
    layers = {}
    for step in PROJECT['steps']:
        if not step['enabled']:
            continue
        target = targets[step['targetId']]
        layer = layers.get(target['id'], 0) if PROJECT['mission'] == 'stack' else 0
        robot.pick_and_place(step['objectId'], target, layer,
                             PROJECT['liftHeight'], PROJECT['placementOffset'])
        layers[target['id']] = layer + 1

if __name__ == '__main__':
    run(RobotAdapter())
`;
}

export function toArduino(project: Project): string {
  const steps = project.steps.filter((s) => s.enabled);
  const targets = Object.fromEntries(MISSIONS[project.mission].targets.map((t) => [t.id, t]));
  const positions = seededPositions(project.seed);

  // Approximate servo mapping for desktop 4-axis arm:
  // Base: 0-180 (center 90)
  // Shoulder: 0-180 (lower = down, higher = back)
  // Elbow: 0-180
  // Gripper: 35 (closed/grip), 90 (open)
  const angleMap: Record<ObjectId, { pickBase: number; pickShoulder: number; pickElbow: number }> = {
    coral: {
      pickBase: Math.round(75 + positions.coral.x * 25),
      pickShoulder: 105,
      pickElbow: 65,
    },
    mint: {
      pickBase: Math.round(90 + positions.mint.x * 25),
      pickShoulder: 110,
      pickElbow: 70,
    },
    blue: {
      pickBase: Math.round(105 + positions.blue.x * 25),
      pickShoulder: 105,
      pickElbow: 65,
    },
  };

  const stepsCode = steps
    .map((step, idx) => {
      const obj = step.objectId;
      const t = targets[step.targetId];
      const pick = angleMap[obj];
      const placeBase = Math.round(90 + (t?.x ?? 0) * 40);
      const placeShoulder = 100;
      const placeElbow = 70;

      return `  // --- Task ${idx + 1}: Pick ${obj} -> Place ${t?.name ?? 'Target'} ---
  Serial.println(F("Task ${idx + 1}: Pick ${obj}"));
  // 1. Move above ${obj}
  moveTo(${pick.pickBase}, 75, 100, 90, 15);
  delay(200);
  // 2. Lower to grab ${obj}
  moveTo(${pick.pickBase}, ${pick.pickShoulder}, ${pick.pickElbow}, 90, 20);
  delay(300);
  // 3. Close gripper (GRIP)
  moveTo(${pick.pickBase}, ${pick.pickShoulder}, ${pick.pickElbow}, 35, 10);
  delay(400);
  // 4. Lift up
  moveTo(${pick.pickBase}, 75, 100, 35, 15);
  delay(250);

  Serial.println(F("Placing at ${t?.name ?? 'Destination'}"));
  // 5. Move above destination
  moveTo(${placeBase}, 75, 100, 35, 15);
  delay(200);
  // 6. Lower into place
  moveTo(${placeBase}, ${placeShoulder}, ${placeElbow}, 35, 20);
  delay(300);
  // 7. Open gripper (RELEASE)
  moveTo(${placeBase}, ${placeShoulder}, ${placeElbow}, 90, 10);
  delay(400);
  // 8. Return to safe transit height
  moveTo(${placeBase}, 75, 100, 90, 15);
  delay(250);`;
    })
    .join('\n\n');

  return `/*
  ======================================================
  Robot Task Lab - 4-Axis DIY Arduino Control Sketch
  Mission: ${project.mission.toUpperCase()} (Seed: ${project.seed})
  Generated: ${new Date().toISOString().slice(0, 10)}
  ======================================================
  
  [Hardware Requirements]
    - Arduino Uno, Nano, or ESP32
    - 4x Micro Servos (SG90 or MG90S metal-gear)
    - 3D-printed 4-axis arm mechanical parts
  
  [Wiring Pinout]
    - Pin 9  -> Base Turntable Servo   (Yaw 0° - 180°)
    - Pin 10 -> Shoulder Servo          (Pitch 0° - 180°)
    - Pin 11 -> Elbow Servo             (Forearm 0° - 180°)
    - Pin 6  -> Gripper Claw Servo      (35° Grip, 90° Open)
  
  [IMPORTANT POWER NOTE]
    Never power 4 servos directly from the Arduino 5V pin!
    Connect an external 5V 2A-3A DC power supply to the servo
    power wires (Red), and connect the power supply GND to
    Arduino GND (Common Ground).
*/

#include <Servo.h>

Servo servoBase;
Servo servoShoulder;
Servo servoElbow;
Servo servoGripper;

int curBase = 90;
int curShoulder = 75;
int curElbow = 100;
int curGripper = 90;

void setup() {
  Serial.begin(115200);
  Serial.println(F("Robot Task Lab - Arm Initializing..."));

  servoBase.attach(9);
  servoShoulder.attach(10);
  servoElbow.attach(11);
  servoGripper.attach(6);

  // Move to initial Home position
  moveTo(90, 75, 100, 90, 20);
  delay(1000);
  Serial.println(F("Home position reached. Starting mission routine..."));
}

void moveTo(int targetBase, int targetShoulder, int targetElbow, int targetGripper, int speedDelay = 15) {
  targetBase = constrain(targetBase, 0, 180);
  targetShoulder = constrain(targetShoulder, 0, 180);
  targetElbow = constrain(targetElbow, 0, 180);
  targetGripper = constrain(targetGripper, 0, 180);

  int maxSteps = max(abs(targetBase - curBase),
                 max(abs(targetShoulder - curShoulder),
                 max(abs(targetElbow - curElbow),
                     abs(targetGripper - curGripper))));

  for (int step = 0; step <= maxSteps; step++) {
    int b = curBase + (targetBase - curBase) * step / max(1, maxSteps);
    int s = curShoulder + (targetShoulder - curShoulder) * step / max(1, maxSteps);
    int e = curElbow + (targetElbow - curElbow) * step / max(1, maxSteps);
    int g = curGripper + (targetGripper - curGripper) * step / max(1, maxSteps);

    servoBase.write(b);
    servoShoulder.write(s);
    servoElbow.write(e);
    servoGripper.write(g);
    delay(speedDelay);
  }

  curBase = targetBase;
  curShoulder = targetShoulder;
  curElbow = targetElbow;
  curGripper = targetGripper;
}

void loop() {
${stepsCode}

  Serial.println(F("Routine complete! Returning Home."));
  moveTo(90, 75, 100, 90, 20);

  // Stop repeating (remove the while loop below if you want it to loop indefinitely)
  Serial.println(F("Execution finished. Halting."));
  while (true) {
    delay(1000);
  }
}
`;
}

export function downloadText(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
