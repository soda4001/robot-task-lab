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

export function downloadText(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
