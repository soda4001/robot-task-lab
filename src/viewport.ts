import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COLORS, MISSIONS, type ObjectId, type Project, type Point } from './model';
import { SHOULDER, Simulation } from './simulation';

const UP = new THREE.Vector3(0, 1, 0);
const vec = (p: Point) => new THREE.Vector3(p.x, p.y, p.z);

export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-3, 3, 2, -2, 0.1, 40);
  controls: OrbitControls;
  private resizeObserver: ResizeObserver;
  private blocks = {} as Record<ObjectId, THREE.Group>;
  private upper: THREE.Group;
  private lower: THREE.Group;
  private elbow: THREE.Group;
  private wrist: THREE.Group;
  private claw: THREE.Group;
  private fingers: THREE.Mesh[] = [];
  private grid: THREE.GridHelper;
  private path = new THREE.Group();
  private selection: THREE.Mesh;
  private selected: ObjectId | null = null;
  private raycaster = new THREE.Raycaster();
  private clickStart = { x: 0, y: 0 };
  private host: HTMLElement;
  private onSelect: (id: ObjectId) => void;
  private project: Project;

  constructor(host: HTMLElement, sim: Simulation, onSelect: (id: ObjectId) => void) {
    this.host = host;
    this.project = sim.project;
    this.onSelect = onSelect;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D robot workcell');
    this.renderer.domElement.setAttribute('role', 'img');
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#e8edea');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#abb3ae', 2.4));
    const light = new THREE.DirectionalLight('#fffaf1', 3.4);
    light.position.set(-3, 6, 4);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -4,
      right: 4,
      top: 4,
      bottom: -4,
      near: 0.5,
      far: 15,
    });
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.025;
    light.shadow.radius = 3;
    this.scene.add(light);
    const rim = new THREE.DirectionalLight('#e0f4ff', 1.8);
    rim.position.set(4, 3, -4);
    this.scene.add(rim);

    const floor = this.box(200, 0.1, 200, '#e5eae7', 0.9);
    floor.position.y = -0.95;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const table = this.box(3.8, 0.12, 2.5, '#fafcfb', 0.75, 0.03);
    table.position.y = -0.06;
    table.receiveShadow = true;
    this.scene.add(table);
    const underside = this.box(3.72, 0.1, 2.42, '#a8b3ad', 0.45, 0.02);
    underside.position.y = -0.17;
    this.scene.add(underside);
    for (const x of [-1.59, 1.59])
      for (const z of [-0.98, 0.98]) {
        const leg = this.box(0.085, 0.71, 0.085, '#9ca6a1', 0.4);
        leg.position.set(x, -0.56, z);
        this.scene.add(leg);
      }
    this.grid = new THREE.GridHelper(3.6, 36, '#c4cfca', '#dbe2de');
    this.grid.scale.z = 0.64;
    this.grid.position.y = 0.004;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(this.grid);

    const plaque = this.label('RTL / WORKCELL 01', '#53615a', 0.7, 0.1);
    plaque.position.set(-1.36, 0.007, 1.08);
    this.scene.add(plaque);
    const units = this.label('X  /  100 mm', '#7e8e85', 0.46, 0.08);
    units.position.set(1.42, 0.008, 1.09);
    this.scene.add(units);
    for (const x of [-1.78, 1.78])
      for (const z of [-1.13, 1.13]) {
        const screw = new THREE.Mesh(
          new THREE.CylinderGeometry(0.023, 0.023, 0.006, 20),
          new THREE.MeshStandardMaterial({ color: '#7c8982', metalness: 0.8, roughness: 0.3 }),
        );
        screw.position.set(x, 0.005, z);
        this.scene.add(screw);
      }

    const basePlate = this.box(0.62, 0.065, 0.57, '#43534b', 0.5, 0.035);
    basePlate.position.set(SHOULDER.x, 0.034, SHOULDER.z);
    this.scene.add(basePlate);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.255, 0.23, 48),
      new THREE.MeshStandardMaterial({ color: '#d5ded8', roughness: 0.35, metalness: 0.35 }),
    );
    base.position.set(SHOULDER.x, 0.17, SHOULDER.z);
    base.castShadow = true;
    this.scene.add(base);
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.226, 0.226, 0.035, 48),
      new THREE.MeshStandardMaterial({ color: '#36b394', roughness: 0.3 }),
    );
    collar.position.set(SHOULDER.x, 0.26, SHOULDER.z);
    this.scene.add(collar);
    const pedestal = this.box(0.28, 0.2, 0.26, '#ecf0ec', 0.35, 0.04);
    pedestal.position.set(SHOULDER.x, 0.34, SHOULDER.z);
    this.scene.add(pedestal);
    const shoulderHub = this.joint(0.145);
    shoulderHub.position.copy(vec(SHOULDER));
    this.scene.add(shoulderHub);
    this.upper = this.link(0.2, '#dfe6e0');
    this.lower = this.link(0.16, '#dfe6e0');
    this.elbow = this.joint(0.135);
    this.wrist = this.joint(0.09);
    this.scene.add(this.upper, this.lower, this.elbow, this.wrist);

    this.claw = new THREE.Group();
    const motor = this.box(0.2, 0.15, 0.16, '#35483e', 0.4, 0.018);
    motor.position.y = 0.175;
    this.claw.add(motor);
    const led = this.box(0.075, 0.013, 0.012, '#79e9b7');
    (led.material as THREE.MeshStandardMaterial).emissive.set('#45b980');
    led.position.set(0, 0.19, 0.086);
    this.claw.add(led);
    for (const side of [-1, 1]) {
      const finger = this.box(0.032, 0.16, 0.12, '#646e69', 0.3, 0.008);
      finger.position.set(side * 0.13, 0.035, 0);
      this.fingers.push(finger);
      this.claw.add(finger);
      const pad = this.box(0.014, 0.055, 0.1, '#263b30', 0.9, 0.003);
      pad.position.set(-side * 0.017, -0.035, 0);
      finger.add(pad);
    }
    this.scene.add(this.claw);

    const station = this.box(0.37, 0.11, 0.26, '#2d4136', 0.45, 0.015);
    station.position.set(-1.33, 0.055, -0.86);
    this.scene.add(station);
    const screen = this.label('ARM 01   /   ONLINE', '#71e4b3', 0.28, 0.07, '#20382a');
    screen.position.set(-1.34, 0.116, -0.86);
    this.scene.add(screen);
    const stop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.037, 0.045, 0.045, 24),
      new THREE.MeshStandardMaterial({ color: '#ed6d55' }),
    );
    stop.position.set(-1.1, 0.03, -0.88);
    this.scene.add(stop);

    for (const target of MISSIONS[sim.project.mission].targets) {
      const base = this.box(target.size, 0.008, target.size, target.color, 0.7, 0.006);
      (base.material as THREE.MeshStandardMaterial).color.lerp(new THREE.Color('#ffffff'), 0.76);
      base.position.set(target.x, 0.005, target.z);
      base.receiveShadow = true;
      this.scene.add(base);
      const edge = target.size / 2;
      for (const [dx, dz, sx, sz] of [
        [-edge, 0, 0.028, target.size],
        [edge, 0, 0.028, target.size],
        [0, -edge, target.size, 0.028],
        [0, edge, target.size, 0.028],
      ]) {
        const wall = this.box(
          sx,
          sim.project.mission === 'sort' ? 0.07 : 0.009,
          sz,
          target.color,
          0.5,
          0.003,
        );
        wall.position.set(
          target.x + dx,
          sim.project.mission === 'sort' ? 0.035 : 0.008,
          target.z + dz,
        );
        this.scene.add(wall);
      }
      const label = this.label(target.name.toUpperCase(), '#64726a', 0.4, 0.08);
      label.position.set(target.x, 0.01, target.z - edge - 0.1);
      this.scene.add(label);
    }

    for (const id of Object.keys(COLORS) as ObjectId[]) {
      const group = new THREE.Group();
      const block = this.box(0.18, 0.18, 0.18, COLORS[id].hex, 0.35, 0.008);
      group.add(block);
      const mark = this.label(id[0].toUpperCase(), '#ffffff', 0.095, 0.095);
      mark.position.y = 0.092;
      group.add(mark);
      group.traverse((child) => {
        child.userData.objectId = id;
      });
      this.blocks[id] = group;
      this.scene.add(group);
    }
    this.selection = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.163, 48),
      new THREE.MeshBasicMaterial({
        color: '#28856a',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    this.selection.rotation.x = -Math.PI / 2;
    this.selection.visible = false;
    this.scene.add(this.selection);

    this.buildPath(sim);
    this.path.visible = false;
    this.scene.add(this.path);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minZoom = 0.7;
    this.controls.maxZoom = 2.5;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minPolarAngle = 0.1;
    this.resetCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.resize();
    this.render(sim);
  }

  private box(x: number, y: number, z: number, color: string, roughness = 0.5, radius = 0) {
    const geo = radius
      ? new RoundedBoxGeometry(x, y, z, 3, radius)
      : new THREE.BoxGeometry(x, y, z);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.1 }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private label(text: string, color: string, width: number, height: number, background?: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = Math.round((768 * height) / width);
    const ctx = canvas.getContext('2d')!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.round(canvas.height * 0.57)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  private joint(radius: number) {
    const group = new THREE.Group();
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, radius * 1.8, 40),
      new THREE.MeshStandardMaterial({ color: '#304b3c', roughness: 0.38, metalness: 0.35 }),
    );
    hub.rotation.x = Math.PI / 2;
    hub.castShadow = true;
    group.add(hub);
    for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.7, radius * 0.7, 0.018, 40),
        new THREE.MeshStandardMaterial({ color: '#69c5a0', roughness: 0.34, metalness: 0.3 }),
      );
      cap.rotation.x = Math.PI / 2;
      cap.position.z = side * radius * 0.95;
      group.add(cap);
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.21, radius * 0.21, 0.022, 12),
        new THREE.MeshStandardMaterial({ color: '#bad0c3', metalness: 0.8, roughness: 0.25 }),
      );
      bolt.rotation.x = Math.PI / 2;
      bolt.position.z = side * radius * 1.03;
      group.add(bolt);
    }
    return group;
  }

  private link(width: number, color: string) {
    const group = new THREE.Group();
    const core = this.box(width * 0.65, 1, width * 0.7, '#54685c', 0.4, 0.04);
    group.add(core);
    for (const z of [-width * 0.39, width * 0.39]) {
      const shell = this.box(width, 0.78, width * 0.3, color, 0.35, 0.035);
      shell.position.z = z;
      group.add(shell);
      const stripe = this.box(width * 0.25, 0.49, 0.009, '#87b19a', 0.4, 0.003);
      stripe.position.set(0, 0, z * 1.4);
      group.add(stripe);
    }
    return group;
  }

  private connect(group: THREE.Group, a: THREE.Vector3, b: THREE.Vector3) {
    const d = b.clone().sub(a);
    group.position.copy(a).add(b).multiplyScalar(0.5);
    group.quaternion.setFromUnitVectors(UP, d.clone().normalize());
    group.scale.y = d.length();
  }

  private buildPath(sim: Simulation) {
    for (const step of sim.project.steps.filter((s) => s.enabled)) {
      const body = sim.bodies[step.objectId];
      const target = MISSIONS[sim.project.mission].targets.find((t) => t.id === step.targetId)!;
      const points = [
        new THREE.Vector3(body.position.x, 0.1, body.position.z),
        new THREE.Vector3(body.position.x, sim.project.liftHeight, body.position.z),
        new THREE.Vector3(target.x, sim.project.liftHeight, target.z),
        new THREE.Vector3(target.x, 0.1, target.z),
      ];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineDashedMaterial({
          color: COLORS[step.objectId].hex,
          dashSize: 0.055,
          gapSize: 0.035,
          transparent: true,
          opacity: 0.7,
        }),
      );
      line.computeLineDistances();
      this.path.add(line);
    }
  }

  render(sim: Simulation) {
    const start = vec(SHOULDER);
    const end = vec(sim.position).add(new THREE.Vector3(0, 0.22, 0));
    const dx = end.x - start.x,
      dz = end.z - start.z;
    const h = Math.hypot(dx, dz);
    const v = end.y - start.y;
    const distance = Math.min(2.099, Math.max(0.201, Math.hypot(h, v)));
    const a = 0.95,
      b = 1.15;
    const angle =
      Math.atan2(v, h) +
      Math.acos(
        THREE.MathUtils.clamp((a * a + distance * distance - b * b) / (2 * a * distance), -1, 1),
      );
    const elbow = start
      .clone()
      .add(
        new THREE.Vector3(
          (dx / h) * Math.cos(angle) * a,
          Math.sin(angle) * a,
          (dz / h) * Math.cos(angle) * a,
        ),
      );
    this.connect(this.upper, start, elbow);
    this.connect(this.lower, elbow, end);
    this.elbow.position.copy(elbow);
    this.elbow.rotation.y = -Math.atan2(dz, dx);
    this.wrist.position.copy(end);
    this.claw.position.copy(vec(sim.position));
    this.fingers.forEach((finger, i) => {
      finger.position.x = (i === 0 ? -1 : 1) * (sim.held ? 0.111 : 0.155);
    });
    for (const id of Object.keys(COLORS) as ObjectId[]) {
      const body = sim.bodies[id];
      this.blocks[id].position.set(body.position.x, body.position.y, body.position.z);
      this.blocks[id].quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      );
    }
    if (this.selected) {
      const body = sim.bodies[this.selected];
      this.selection.position.set(body.position.x, 0.016, body.position.z);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resetCamera(mode: 'perspective' | 'top' | 'front' = 'perspective') {
    this.controls.target.set(0, 0.29, 0);
    if (mode === 'top') this.camera.position.set(0, 7, 0.001);
    else if (mode === 'front') this.camera.position.set(0, 1.9, 7);
    else this.camera.position.set(4.2, 3.8, 5.6);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  setGrid(value: boolean) {
    this.grid.visible = value;
  }
  setPath(value: boolean) {
    this.path.visible = value;
  }
  setSelected(id: ObjectId | null) {
    this.selected = id;
    this.selection.visible = id !== null;
  }
  zoom(amount: number) {
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom + amount, 0.7, 2.5);
    this.camera.updateProjectionMatrix();
  }
  screenshot() {
    return this.renderer.domElement.toDataURL('image/png');
  }

  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    const header = window.innerWidth >= 1700 ? 160 : 145;
    const footer = 70;
    const contentHeight = Math.max(120, height - header - footer);
    const aspect = width / contentHeight;
    const vertical = Math.max(3.25, 5.1 / aspect);
    this.camera.left = (-vertical * aspect) / 2;
    this.camera.right = (vertical * aspect) / 2;
    // Keep the workcell below the title and above transport while the canvas stays full-bleed.
    this.camera.top = vertical / 2 + (vertical * header) / contentHeight;
    this.camera.bottom = -vertical / 2 - (vertical * footer) / contentHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  private pointerDown = (e: PointerEvent) => {
    this.clickStart = { x: e.clientX, y: e.clientY };
  };
  private pointerUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.clickStart.x, e.clientY - this.clickStart.y) > 5) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const hit = this.raycaster.intersectObjects(Object.values(this.blocks), true)[0];
    if (hit?.object.userData.objectId) this.onSelect(hit.object.userData.objectId);
  };
  dispose() {
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if ('map' in material) (material.map as THREE.Texture | null)?.dispose();
          material.dispose();
        });
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
