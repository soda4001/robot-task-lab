import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Box,
  Boxes,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Download,
  FileJson,
  FlaskConical,
  Focus,
  Grid2X2,
  Bot as Grip,
  Layers3,
  ListOrdered,
  LoaderCircle,
  MousePointer2,
  Move3D,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Route,
  Save,
  ScanLine,
  Settings2,
  Shuffle,
  SkipForward,
  Terminal,
  Trash2,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  COLORS,
  MISSIONS,
  compileRecipe,
  createProject,
  downloadText,
  parseProject,
  toPython,
  type MissionId,
  type ObjectId,
  type Project,
  type Step,
} from './model';
import { Simulation, type RunResult, type Snapshot } from './simulation';
import { Viewport } from './viewport';

const STORAGE_KEY = 'robot-task-lab.project.v1';
const HISTORY_KEY = 'robot-task-lab.runs.v1';
function loadProject(): Project {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseProject(saved) : createProject();
  } catch {
    return createProject();
  }
}
function loadHistory(): RunResult[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(value)
      ? value
          .filter(
            (r) =>
              r &&
              typeof r.id === 'string' &&
              typeof r.passed === 'boolean' &&
              typeof r.duration === 'number' &&
              Array.isArray(r.checks) &&
              r.mission in MISSIONS,
          )
          .slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

function IconButton({
  label,
  children,
  active,
  ...props
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${props.className ?? ''}`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
function Swatch({ id }: { id: ObjectId }) {
  return <span className="swatch" style={{ background: COLORS[id].hex }} />;
}
function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-inner">
        <header className="modal-header">
          <h2>{title}</h2>
          <IconButton label="Close dialog" onClick={close}>
            <X size={18} />
          </IconButton>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export default function App() {
  const [project, setProject] = useState(loadProject);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => new Simulation(project).snapshot());
  const [selectedStep, setSelectedStep] = useState(project.steps[0]?.id ?? '');
  const [selectedObject, setSelectedObject] = useState<ObjectId>('coral');
  const [inspector, setInspector] = useState<'task' | 'objects' | 'runs'>('task');
  const [mobileView, setMobileView] = useState<'scene' | 'program' | 'inspector'>('scene');
  const [modal, setModal] = useState<'library' | 'export' | 'recipe' | 'about' | null>(null);
  const [exportFormat, setExportFormat] = useState<'json' | 'python'>('json');
  const [recipeOrder, setRecipeOrder] = useState<'left-to-right' | 'right-to-left' | 'blue-first'>(
    'left-to-right',
  );
  const [speed, setSpeed] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showPath, setShowPath] = useState(false);
  const [view, setView] = useState<'perspective' | 'top' | 'front'>('perspective');
  const [saved, setSaved] = useState(true);
  const [toast, setToast] = useState('');
  const [viewError, setViewError] = useState('');
  const [history, setHistory] = useState<RunResult[]>(loadHistory);
  const [testing, setTesting] = useState(false);
  const [batch, setBatch] = useState<RunResult[] | null>(null);
  const [logTab, setLogTab] = useState<'events' | 'validation'>('events');
  const [resetKey, setResetKey] = useState(0);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const viewport = useRef<Viewport | null>(null);
  const simulation = useRef<Simulation | null>(null);
  const speedRef = useRef(speed);
  const resultCallback = useRef<(result: RunResult) => void>(() => {});
  const importRef = useRef<HTMLInputElement>(null);
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const worker = useRef<Worker | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dismissedOnboarding, setDismissedOnboarding] = useState(() => {
    try {
      return localStorage.getItem('rtl_onboarding_dismissed') === '1';
    } catch {
      return false;
    }
  });
  const mission = MISSIONS[project.mission];
  const task = project.steps.find((s) => s.id === selectedStep);
  const running = snapshot.status === 'running';
  const busy = running || snapshot.status === 'paused';
  const enabled = project.steps.filter((s) => s.enabled);
  const missionHistory = history.filter((r) => r.mission === project.mission);
  const latest = snapshot.result ?? null;
  const worldKey = JSON.stringify({
    mission: project.mission,
    seed: project.seed,
    steps: project.steps,
    liftHeight: project.liftHeight,
    placementOffset: project.placementOffset,
  });
  const exportText = exportFormat === 'json' ? JSON.stringify(project, null, 2) : toPython(project);

  const NEXT_MISSION: Record<MissionId, MissionId | null> = {
    sort: 'precision',
    precision: 'stack',
    stack: null,
  };

  const MISSION_HINTS: Record<MissionId, string> = {
    sort: 'Hint: Make sure each block matches its matching color tray (Coral → Coral, Mint → Mint, Blue → Blue).',
    precision: 'Hint: Tight margins! Check the sequence order, or expand Advanced Physics to adjust lift clearance.',
    stack: 'Hint: The tower requires placing the base block first before stacking higher layers.',
  };

  function switchMission(targetMission: MissionId) {
    if (busy || testing) return;
    const next = createProject(targetMission);
    update(next);
    setSelectedStep(next.steps[0].id);
    setMobileView('scene');
    reset();
  }

  function notify(message: string) {
    setToast(message);
  }
  function update(next: Project) {
    if (busy || testing) return;
    undoStack.current = [...undoStack.current.slice(-39), project];
    redoStack.current = [];
    setUndoCount(undoStack.current.length);
    setRedoCount(0);
    setProject(next);
    setBatch(null);
  }
  function updateTask(patch: Partial<Step>) {
    if (task)
      update({
        ...project,
        steps: project.steps.map((s) => (s.id === task.id ? { ...s, ...patch } : s)),
      });
  }
  function undo() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(project);
    setProject(previous);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
    setBatch(null);
  }
  function redo() {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(project);
    setProject(next);
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
    setBatch(null);
  }
  function moveStep(index: number, delta: number) {
    const steps = [...project.steps];
    [steps[index], steps[index + delta]] = [steps[index + delta], steps[index]];
    update({ ...project, steps });
  }
  function addStep() {
    const ids = Object.keys(COLORS) as ObjectId[];
    const objectId = ids[project.steps.length % 3];
    const step: Step = {
      id: crypto.randomUUID(),
      objectId,
      targetId: mission.targets[project.mission === 'stack' ? 0 : project.steps.length % 3].id,
      enabled: true,
    };
    update({ ...project, steps: [...project.steps, step] });
    setSelectedStep(step.id);
    setInspector('task');
  }
  function reset() {
    setResetKey((key) => key + 1);
  }
  function run() {
    if (!dismissedOnboarding) {
      setDismissedOnboarding(true);
      try {
        localStorage.setItem('rtl_onboarding_dismissed', '1');
      } catch {}
    }
    if (snapshot.status === 'complete' || snapshot.status === 'failed') {
      const sim = new Simulation(project);
      simulation.current = sim;
      sim.start();
      setSnapshot(sim.snapshot());
    } else {
      simulation.current?.start();
      if (simulation.current) setSnapshot(simulation.current.snapshot());
    }
  }
  function selectTask(id: string) {
    setSelectedStep(id);
    setInspector('task');
  }
  function saveFile() {
    downloadText('robot-task.json', JSON.stringify(project, null, 2));
    notify('Project downloaded.');
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error('Project exceeds the 100 KB limit.');
      const next = parseProject(await file.text());
      update(next);
      setSelectedStep(next.steps[0]?.id ?? '');
      notify('Project imported.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not import this file.');
    }
    if (importRef.current) importRef.current.value = '';
  }
  function startBenchmark() {
    if (!enabled.length) {
      notify('Enable at least one task before testing.');
      return;
    }
    setTesting(true);
    setInspector('runs');
    setMobileView('inspector');
    setBatch(null);
    const w = new Worker(new URL('./benchmark.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (event) => {
      setTesting(false);
      if (event.data.error) notify(event.data.error);
      else {
        const results = event.data.results as RunResult[];
        setBatch(results);
        setHistory((old) => [...results, ...old].slice(0, 50));
        notify(
          `${results.filter((r) => r.passed).length} of ${results.length} test layouts passed.`,
        );
      }
      w.terminate();
      worker.current = null;
    };
    w.onerror = () => {
      setTesting(false);
      notify('The test worker stopped unexpectedly.');
      w.terminate();
      worker.current = null;
    };
    w.postMessage(project);
  }
  function exportResults() {
    const rows = ['mission,seed,passed,duration_seconds,object,target,error_mm,object_passed'];
    for (const r of batch ?? missionHistory)
      for (const c of r.checks)
        rows.push(
          [
            r.mission,
            r.seed,
            r.passed,
            r.duration.toFixed(2),
            c.objectId,
            c.target,
            c.errorMm,
            c.passed,
          ].join(','),
        );
    downloadText('robot-task-results.csv', rows.join('\n'), 'text/csv');
  }

  resultCallback.current = (result) => {
    setHistory((old) => [result, ...old.filter((r) => r.id !== result.id)].slice(0, 50));
    setLogTab('validation');
  };
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    setSaved(false);
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        setSaved(true);
      } catch {
        notify('Browser storage is full. Download your project to keep it.');
      }
    }, 350);
    return () => clearTimeout(timeout);
  }, [project]);
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      /* History is optional when storage is unavailable. */
    }
  }, [history]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [snapshot.logs.length, logTab]);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!project.steps.some((s) => s.id === selectedStep))
      setSelectedStep(project.steps[0]?.id ?? '');
  }, [project.steps, selectedStep]);

  useEffect(() => {
    const sim = new Simulation(project);
    simulation.current = sim;
    setSnapshot(sim.snapshot());
    setLogTab('events');
    let renderer: Viewport;
    try {
      renderer = new Viewport(host.current!, sim, (id) => {
        setSelectedObject(id);
        setInspector('objects');
      });
      viewport.current = renderer;
      setViewError('');
      renderer.setGrid(showGrid);
      renderer.setPath(showPath);
      renderer.resetCamera(view);
    } catch (error) {
      setViewError(error instanceof Error ? error.message : 'WebGL is unavailable.');
      return;
    }
    let frame = 0,
      last = performance.now(),
      accumulated = 0,
      lastUpdate = 0;
    let reported: string | null = null;
    const loop = (now: number) => {
      const current = simulation.current!;
      const delta = Math.min((now - last) / 1000, 0.06);
      last = now;
      if (current.status === 'running') {
        accumulated += delta * speedRef.current;
        while (accumulated >= 1 / 120) {
          current.tick(1 / 120);
          accumulated -= 1 / 120;
        }
      } else accumulated = 0;
      renderer.render(current);
      if (now - lastUpdate > 80) {
        setSnapshot(current.snapshot());
        lastUpdate = now;
      }
      if (current.result && current.result.id !== reported) {
        reported = current.result.id;
        resultCallback.current(current.result);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      renderer.dispose();
      viewport.current = null;
    };
    // Project changes reset the physical world; display-only controls are applied below.
  }, [worldKey, resetKey]);
  useEffect(() => {
    viewport.current?.setGrid(showGrid);
  }, [showGrid]);
  useEffect(() => {
    viewport.current?.setPath(showPath);
  }, [showPath]);
  useEffect(() => {
    viewport.current?.resetCamera(view);
  }, [view]);
  useEffect(() => {
    viewport.current?.setSelected(inspector === 'objects' ? selectedObject : null);
  }, [selectedObject, inspector, project, resetKey]);

  return (
    <div className="app" data-run-status={snapshot.status}>
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="Robot Task Lab home"
        >
          <span className="brand-mark">
            <Grip size={22} strokeWidth={2.2} />
          </span>
          <span>
            Robot Task <strong>Lab</strong>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <nav className="primary-nav" aria-label="Main navigation">
          <button
            className="nav-active"
            onClick={() => {
              setModal(null);
              setMobileView('scene');
            }}
          >
            <Box size={16} />
            Workbench
          </button>
          <button onClick={() => setModal('library')} disabled={busy || testing}>
            <Boxes size={16} />
            Lab library<span className="count">3</span>
          </button>
        </nav>
        <div className="header-end">
          <span className="save-state">
            <span className={`status-dot ${saved ? '' : 'pending'}`} />
            {saved ? 'Saved on this device' : 'Saving...'}
          </span>
          <IconButton label="About this lab" onClick={() => setModal('about')}>
            <CircleHelp size={18} />
          </IconButton>
          <button className="button export-button" onClick={() => setModal('export')}>
            <Download size={15} />
            Export
            <ChevronDown size={13} />
          </button>
        </div>
      </header>

      <div className="project-bar">
        <div className="project-name">
          <span className="workcell-tag">WORKCELL 01</span>
          <span className="divider-slash">/</span>
          <input
            aria-label="Project name"
            value={project.name}
            disabled={busy || testing}
            maxLength={64}
            onChange={(e) => {
              if (e.target.value.trim()) update({ ...project, name: e.target.value });
            }}
          />
        </div>
        <div className="project-actions">
          <span className="local-badge">
            <CircleDot size={12} />
            Local project
          </span>
          <IconButton
            label="Import project"
            disabled={busy || testing}
            onClick={() => importRef.current?.click()}
          >
            <Upload size={16} />
          </IconButton>
          <IconButton label="Download project" onClick={saveFile}>
            <Save size={16} />
          </IconButton>
        </div>
      </div>
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => importFile(e.target.files?.[0])}
      />

      <nav className="mobile-tabs" aria-label="Workspace views">
        {(['scene', 'program', 'inspector'] as const).map((tab) => (
          <button
            key={tab}
            className={mobileView === tab ? 'active' : ''}
            onClick={() => setMobileView(tab)}
          >
            {tab === 'scene' ? (
              <Box size={15} />
            ) : tab === 'program' ? (
              <ListOrdered size={15} />
            ) : (
              <Settings2 size={15} />
            )}
            {tab === 'inspector' ? 'Inspect' : tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      <main className={`workspace mobile-${mobileView}`}>
        <aside className="program-panel">
          <div className="panel-heading">
            <h2>
              <ListOrdered size={16} />
              Program
            </h2>
            <div className="inline-actions">
              <IconButton label="Undo edit" disabled={!undoCount || busy || testing} onClick={undo}>
                <Undo2 size={14} />
              </IconButton>
              <IconButton label="Redo edit" disabled={!redoCount || busy || testing} onClick={redo}>
                <Redo2 size={14} />
              </IconButton>
            </div>
          </div>
          <button
            className="mission-picker"
            disabled={busy || testing}
            onClick={() => setModal('library')}
          >
            <span className="mission-number">{mission.label}</span>
            <span>
              <small>ACTIVE LAB</small>
              <strong>{mission.title}</strong>
            </span>
            <ChevronDown size={15} />
          </button>
          <div className="routine-title">
            <span>Task sequence</span>
            <span className="mono">{String(enabled.length).padStart(2, '0')} TASKS</span>
          </div>
          <div className="task-list">
            {project.steps.map((step, index) => {
              const active = running && enabled[snapshot.activeIndex]?.id === step.id;
              const done =
                enabled.findIndex((s) => s.id === step.id) < snapshot.completed &&
                step.enabled &&
                snapshot.status !== 'ready';
              return (
                <article
                  className={`task-card ${selectedStep === step.id ? 'selected' : ''} ${active ? 'executing' : ''} ${step.enabled ? '' : 'disabled-task'}`}
                  key={step.id}
                >
                  <button
                    className="task-select"
                    onClick={() => selectTask(step.id)}
                    aria-label={`Edit task ${index + 1}: ${COLORS[step.objectId].name}`}
                    aria-pressed={selectedStep === step.id}
                  >
                    <span className={`step-number ${done ? 'done' : ''}`}>
                      {done ? <Check size={12} /> : String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="task-content">
                      <span className="task-operation">
                        PICK & PLACE {active && <span className="live-dot" />}
                      </span>
                      <strong>
                        <Swatch id={step.objectId} />
                        {COLORS[step.objectId].name}
                      </strong>
                      <span className="task-destination">
                        <ArrowRight size={12} />
                        {mission.targets.find((t) => t.id === step.targetId)?.name}
                      </span>
                    </div>
                    <ChevronRight size={13} className="task-chevron" />
                  </button>
                  <div className="task-controls">
                    <label className="enable-task">
                      <input
                        type="checkbox"
                        checked={step.enabled}
                        disabled={busy || testing}
                        aria-label={`Enable task ${index + 1}`}
                        onChange={(e) =>
                          update({
                            ...project,
                            steps: project.steps.map((s) =>
                              s.id === step.id ? { ...s, enabled: e.target.checked } : s,
                            ),
                          })
                        }
                      />
                      <span>{step.enabled ? 'Enabled' : 'Skipped'}</span>
                    </label>
                    <span className="inline-actions">
                      <IconButton
                        label={`Move task ${index + 1} up`}
                        disabled={index === 0 || busy || testing}
                        onClick={() => moveStep(index, -1)}
                      >
                        <ArrowUp size={12} />
                      </IconButton>
                      <IconButton
                        label={`Move task ${index + 1} down`}
                        disabled={index === project.steps.length - 1 || busy || testing}
                        onClick={() => moveStep(index, 1)}
                      >
                        <ArrowDown size={12} />
                      </IconButton>
                    </span>
                  </div>
                </article>
              );
            })}
            {!project.steps.length && (
              <div className="empty-state">
                <ListOrdered size={28} />
                <strong>No tasks yet</strong>
              </div>
            )}
            <button
              className="add-task"
              onClick={addStep}
              disabled={project.steps.length >= 12 || busy || testing}
            >
              <Plus size={15} />
              Add task
            </button>
          </div>
          <div className="program-bottom">
            <button
              className="recipe-button"
              onClick={() => setModal('recipe')}
              disabled={busy || testing}
            >
              <Route size={16} />
              <span>Build from recipe</span>
              <ArrowRight size={14} />
            </button>
            <div className="program-meta">
              <span>
                <Layers3 size={12} />
                {enabled.length * 8} motion phases
              </span>
              <span className="mono">v1.0</span>
            </div>
          </div>
        </aside>

        <section className="scene-panel" aria-label="Robot simulation">
          <div ref={host} className="viewport" />
          {viewError && (
            <div className="webgl-error">
              <CircleHelp />
              <strong>3D view unavailable</strong>
              <p>{viewError}</p>
              <button className="button" onClick={reset}>
                Retry
              </button>
            </div>
          )}
          <div className="scene-top">
            <div className="scene-label">
              <span className="live-dot" />
              <span>Live simulation</span>
              <span className="scene-label-divider" />
              <span className="mono">ARM-01</span>
            </div>
            <div className="scene-tools">
              <select
                aria-label="Camera view"
                value={view}
                onChange={(e) => setView(e.target.value as typeof view)}
              >
                <option value="perspective">Perspective</option>
                <option value="top">Top view</option>
                <option value="front">Front view</option>
              </select>
              <IconButton
                label="Show grid"
                active={showGrid}
                onClick={() => setShowGrid(!showGrid)}
              >
                <Grid2X2 size={15} />
              </IconButton>
              <IconButton
                label="Show motion paths"
                active={showPath}
                onClick={() => setShowPath(!showPath)}
              >
                <Route size={15} />
              </IconButton>
            </div>
          </div>
          <div className="scene-title">
            <span className="eyebrow">MANIPULATION LAB / {mission.label}</span>
            <h1>{mission.title}</h1>
            <div className="mission-goal-bar">
              <span className="goal-tag">GOAL</span>
              <span className="goal-text">{mission.description}</span>
            </div>
            {latest && (
              <div className={`result-banner ${latest.passed ? 'passed' : 'failed'}`} role="status">
                <div className="result-status-line">
                  <span className="result-summary">
                    {latest.passed ? <CircleCheck size={16} /> : <CircleHelp size={16} />}
                    <strong>
                      {latest.passed ? 'Mission Complete!' : 'Placement needs correction'}
                    </strong>
                  </span>
                  <span className="mono result-score">
                    {latest.checks.filter((c) => c.passed).length}/3 passed
                  </span>
                  <button
                    className="result-details-btn"
                    onClick={() => {
                      setInspector('runs');
                      setMobileView('inspector');
                    }}
                    aria-label="View run results"
                    title="View details"
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
                {latest.passed ? (
                  NEXT_MISSION[project.mission] ? (
                    <div className="celebration-row">
                      <button
                        className="next-mission-btn"
                        onClick={() => switchMission(NEXT_MISSION[project.mission]!)}
                      >
                        <span>Next Challenge: {MISSIONS[NEXT_MISSION[project.mission]!].title}</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="celebration-row">
                      <span className="all-mastered-tag">🏆 All 3 Labs Mastered!</span>
                    </div>
                  )
                ) : (
                  <div className="result-hint-row">
                    <span>💡 {MISSION_HINTS[project.mission]}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="viewport-rail">
            <IconButton label="Reset camera" onClick={() => viewport.current?.resetCamera(view)}>
              <Focus size={17} />
            </IconButton>
            <IconButton label="Zoom in" onClick={() => viewport.current?.zoom(0.15)}>
              <ZoomIn size={17} />
            </IconButton>
            <IconButton label="Zoom out" onClick={() => viewport.current?.zoom(-0.15)}>
              <ZoomOut size={17} />
            </IconButton>
            <span className="rail-divider" />
            <IconButton
              label="Download scene image"
              onClick={() => {
                const url = viewport.current?.screenshot();
                if (url) {
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'robot-task-lab.png';
                  a.click();
                }
              }}
            >
              <ScanLine size={17} />
            </IconButton>
          </div>
          <div className="scene-bottom-label">
            <Move3D size={25} strokeWidth={1.2} />
            <span className="mono">
              Y UP<span>METERS</span>
            </span>
          </div>
          <div className="scene-status">
            <span className={`status-dot ${running ? 'pulsing' : ''}`} />
            <span>{snapshot.phase}</span>
          </div>
          {!dismissedOnboarding && !latest && !running && (
            <div className="onboarding-guide" role="status">
              <div className="onboarding-guide-text">
                <span className="onboarding-tag">QUICK START</span>
                <strong>Start with 1 Click</strong>
                <p>Click <strong>Run</strong> below to watch the robot sort blocks into trays!</p>
              </div>
              <button
                type="button"
                className="onboarding-dismiss-btn"
                onClick={() => {
                  setDismissedOnboarding(true);
                  try {
                    localStorage.setItem('rtl_onboarding_dismissed', '1');
                  } catch {}
                }}
                aria-label="Dismiss hint"
              >
                Got it
              </button>
            </div>
          )}
          <div className="transport">
            <IconButton label="Reset simulation" onClick={reset} disabled={testing}>
              <RotateCcw size={17} />
            </IconButton>
            <span className="transport-separator" />
            <button
              className={`run-button ${running ? 'is-running' : ''} ${!dismissedOnboarding && !latest && !running ? 'pulsing-attention' : ''}`}
              aria-label={
                running
                  ? 'Pause simulation'
                  : snapshot.status === 'paused'
                    ? 'Resume simulation'
                    : 'Run simulation'
              }
              disabled={!enabled.length || !!viewError || testing}
              onClick={() => {
                if (running) {
                  simulation.current?.pause();
                  setSnapshot(simulation.current!.snapshot());
                } else run();
              }}
            >
              {running ? (
                <Pause size={16} fill="currentColor" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              <span>
                {running
                  ? 'Pause'
                  : snapshot.status === 'paused'
                    ? 'Resume'
                    : snapshot.status === 'complete'
                      ? 'Run again'
                      : 'Run'}
              </span>
            </button>
            <IconButton
              label="Step one task"
              disabled={
                running ||
                snapshot.status === 'complete' ||
                snapshot.status === 'failed' ||
                !enabled.length ||
                testing
              }
              onClick={() => {
                simulation.current?.stepTask();
                setSnapshot(simulation.current!.snapshot());
              }}
            >
              <SkipForward size={17} />
            </IconButton>
            <span className="transport-separator" />
            <select
              aria-label="Simulation speed"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs" role="tablist" aria-label="Inspector">
            {(['task', 'objects', 'runs'] as const).map((tab) => (
              <button
                role="tab"
                aria-selected={inspector === tab}
                key={tab}
                className={inspector === tab ? 'active' : ''}
                onClick={() => setInspector(tab)}
              >
                {tab === 'task' ? (
                  <Settings2 size={14} />
                ) : tab === 'objects' ? (
                  <Box size={14} />
                ) : (
                  <FlaskConical size={14} />
                )}
                {tab === 'task' ? 'Task' : tab === 'objects' ? 'Objects' : 'Runs'}
              </button>
            ))}
          </div>
          <div className="inspector-content">
            {inspector === 'task' && (
              <>
                <div className="section-caption">
                  <span>TASK PROPERTIES</span>
                  <span className="mono">
                    {task ? String(project.steps.indexOf(task) + 1).padStart(2, '0') : '--'}
                  </span>
                </div>
                {task ? (
                  <>
                    <h3 className="property-title">
                      <span className="property-icon">
                        <Grip size={19} />
                      </span>
                      Pick & place
                    </h3>
                    <label className="field-label">
                      Object
                      <select
                        aria-label="Task object"
                        disabled={busy || testing}
                        value={task.objectId}
                        onChange={(e) => updateTask({ objectId: e.target.value as ObjectId })}
                      >
                        {(Object.keys(COLORS) as ObjectId[]).map((id) => (
                          <option key={id} value={id}>
                            {COLORS[id].name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="field-connector">
                      <ArrowDown size={13} />
                    </div>
                    <label className="field-label">
                      Destination
                      <select
                        aria-label="Task destination"
                        disabled={busy || testing}
                        value={task.targetId}
                        onChange={(e) => updateTask({ targetId: e.target.value })}
                      >
                        {mission.targets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="task-delete-row">
                      <span>Parallel gripper</span>
                      <IconButton
                        label="Delete selected task"
                        disabled={busy || testing}
                        onClick={() =>
                          update({
                            ...project,
                            steps: project.steps.filter((s) => s.id !== selectedStep),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <MousePointer2 size={24} />
                    <strong>No task selected</strong>
                  </div>
                )}
                <div className="advanced-toggle-wrapper">
                  <button
                    type="button"
                    className={`advanced-toggle-btn ${showAdvanced ? 'active' : ''}`}
                    onClick={() => setShowAdvanced((v) => !v)}
                    aria-expanded={showAdvanced}
                  >
                    <Settings2 size={13} />
                    <span>Advanced Physics & Parameters</span>
                    <ChevronDown size={14} className={`chevron-icon ${showAdvanced ? 'open' : ''}`} />
                  </button>
                </div>
                {showAdvanced && (
                  <div className="advanced-sections">
                    <section className="inspector-section">
                      <div className="section-caption">
                        <span>MOTION SETTINGS</span>
                        <Route size={13} />
                      </div>
                      <label className="range-label">
                        <span>
                          Lift clearance
                          <output>
                            {project.liftHeight.toFixed(2)} <small>m</small>
                          </output>
                        </span>
                        <input
                          aria-label="Lift clearance"
                          type="range"
                          min="0.42"
                          max="1.05"
                          step="0.01"
                          value={project.liftHeight}
                          disabled={busy || testing}
                          onChange={(e) => update({ ...project, liftHeight: Number(e.target.value) })}
                        />
                      </label>
                      <label className="range-label">
                        <span>
                          Placement offset
                          <output>
                            {Math.round(project.placementOffset * 1000)} <small>mm</small>
                          </output>
                        </span>
                        <input
                          aria-label="Placement offset"
                          type="range"
                          min="-0.12"
                          max="0.12"
                          step="0.005"
                          value={project.placementOffset}
                          disabled={busy || testing}
                          onChange={(e) =>
                            update({ ...project, placementOffset: Number(e.target.value) })
                          }
                        />
                      </label>
                    </section>
                    <section className="inspector-section">
                      <div className="section-caption">
                        <span>WORKCELL</span>
                        <Grid2X2 size={13} />
                      </div>
                      <div className="data-row">
                        <span>Gravity</span>
                        <span className="mono">
                          9.81 m/s<sup>2</sup>
                        </span>
                      </div>
                      <div className="data-row">
                        <span>Object mass</span>
                        <span className="mono">150 g</span>
                      </div>
                      <div className="seed-row">
                        <label htmlFor="scene-seed">Layout seed</label>
                        <input
                          id="scene-seed"
                          type="number"
                          min={1}
                          max={999999}
                          value={project.seed}
                          disabled={busy || testing}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isInteger(n) && n > 0 && n <= 999999)
                              update({ ...project, seed: n });
                          }}
                        />
                        <IconButton
                          label="Randomize object layout"
                          disabled={busy || testing}
                          onClick={() =>
                            update({ ...project, seed: Math.floor(Math.random() * 999999) + 1 })
                          }
                        >
                          <Shuffle size={14} />
                        </IconButton>
                      </div>
                    </section>
                  </div>
                )}
              </>
            )}
            {inspector === 'objects' && (
              <>
                <div className="section-caption">
                  <span>SCENE OBJECTS</span>
                  <span className="mono">03</span>
                </div>
                <div className="object-list">
                  {(Object.keys(COLORS) as ObjectId[]).map((id) => (
                    <button
                      key={id}
                      className={selectedObject === id ? 'selected' : ''}
                      onClick={() => setSelectedObject(id)}
                    >
                      <Swatch id={id} />
                      <strong>{COLORS[id].name}</strong>
                      <span className="mono">150 g</span>
                    </button>
                  ))}
                </div>
                <section className="inspector-section">
                  <div className="section-caption">
                    <span>WORLD POSITION</span>
                    <Move3D size={14} />
                  </div>
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <div key={axis} className="coordinate-row">
                      <span className={`axis ${axis}`}>{axis.toUpperCase()}</span>
                      <span className="mono">
                        {snapshot.objects[selectedObject][axis].toFixed(3)}
                      </span>
                      <small>m</small>
                    </div>
                  ))}
                  <div className="data-row">
                    <span>Body</span>
                    <strong>Dynamic</strong>
                  </div>
                  <div className="data-row">
                    <span>Dimensions</span>
                    <span className="mono">180 mm cube</span>
                  </div>
                  <div className="data-row">
                    <span>Gripper</span>
                    <strong>
                      {snapshot.grip && simulation.current?.held === selectedObject
                        ? 'Attached'
                        : 'Free'}
                    </strong>
                  </div>
                </section>
                <section className="inspector-section">
                  <div className="section-caption">
                    <span>DESTINATIONS</span>
                    <span className="mono">{String(mission.targets.length).padStart(2, '0')}</span>
                  </div>
                  {mission.targets.map((target) => (
                    <div className="destination-row" key={target.id}>
                      <span className="target-swatch" style={{ borderColor: target.color }} />
                      <span>{target.name}</span>
                      <span className="mono">{Math.round(target.size * 1000)}</span>
                    </div>
                  ))}
                </section>
              </>
            )}
            {inspector === 'runs' && (
              <>
                <div className="section-caption">
                  <span>VALIDATION</span>
                  <FlaskConical size={14} />
                </div>
                <div className="run-score">
                  <span className="score-value">
                    {batch
                      ? Math.round((batch.filter((r) => r.passed).length / batch.length) * 100)
                      : missionHistory.length
                        ? Math.round(
                            (missionHistory.filter((r) => r.passed).length /
                              missionHistory.length) *
                              100,
                          )
                        : '--'}
                    <small>%</small>
                  </span>
                  <span>{batch ? 'Batch success rate' : 'Recorded success rate'}</span>
                </div>
                {testing ? (
                  <div className="testing-state">
                    <LoaderCircle className="spin" size={20} />
                    <strong>Testing 10 layouts</strong>
                    <button
                      className="button small"
                      onClick={() => {
                        worker.current?.terminate();
                        worker.current = null;
                        setTesting(false);
                        notify('Batch cancelled.');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="button test-button"
                    disabled={busy || !enabled.length}
                    onClick={startBenchmark}
                  >
                    <FlaskConical size={15} />
                    Test 10 layouts
                    <ArrowRight size={14} />
                  </button>
                )}
                {batch && (
                  <div className="batch-seeds">
                    {batch.map((r) => (
                      <span
                        key={r.id}
                        className={r.passed ? 'pass' : 'fail'}
                        title={`Seed ${r.seed}: ${r.passed ? 'passed' : 'failed'}`}
                      >
                        {r.passed ? <Check size={13} /> : <X size={13} />}
                      </span>
                    ))}
                  </div>
                )}
                <section className="inspector-section">
                  <div className="section-caption">
                    <span>RECENT RUNS</span>
                    <IconButton
                      label="Export validation CSV"
                      disabled={!missionHistory.length}
                      onClick={exportResults}
                    >
                      <Download size={14} />
                    </IconButton>
                  </div>
                  {!missionHistory.length ? (
                    <div className="empty-state">
                      <FlaskConical size={25} />
                      <strong>No runs recorded</strong>
                      <span>Awaiting first run</span>
                    </div>
                  ) : (
                    <div className="run-history">
                      {missionHistory.slice(0, 10).map((r) => (
                        <div key={r.id} className="history-row">
                          <span className={r.passed ? 'result-pass' : 'result-fail'}>
                            {r.passed ? <CircleCheck size={15} /> : <CircleHelp size={15} />}
                          </span>
                          <span>
                            <strong>{r.passed ? 'Passed' : 'Failed'}</strong>
                            <small>Seed {r.seed}</small>
                          </span>
                          <span className="mono">{r.duration.toFixed(1)}s</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
          <div className="robot-telemetry">
            <div className="telemetry-title">
              <span>
                <span className="status-dot" />
                Arm telemetry
              </span>
              <span className="mono">LIVE</span>
            </div>
            <div className="telemetry-values">
              <span>
                <small>X</small>
                {snapshot.position.x.toFixed(2)}
              </span>
              <span>
                <small>Y</small>
                {snapshot.position.y.toFixed(2)}
              </span>
              <span>
                <small>Z</small>
                {snapshot.position.z.toFixed(2)}
              </span>
              <span>
                <Grip size={13} />
                {snapshot.grip ? 'HOLD' : 'OPEN'}
              </span>
            </div>
          </div>
        </aside>
      </main>

      <section className="run-console">
        <div className="console-header">
          <div className="console-tabs">
            <button
              className={logTab === 'events' ? 'active' : ''}
              onClick={() => setLogTab('events')}
            >
              <Terminal size={14} />
              Event log<span className="count">{snapshot.logs.length}</span>
            </button>
            <button
              className={logTab === 'validation' ? 'active' : ''}
              onClick={() => setLogTab('validation')}
            >
              <CheckCheck size={14} />
              Validation
              {latest && (
                <span className={latest.passed ? 'result-pass' : 'result-fail'}>
                  {latest.passed ? '3/3' : `${latest.checks.filter((c) => c.passed).length}/3`}
                </span>
              )}
            </button>
          </div>
          <div className="console-metrics">
            <span>
              <Clock3 size={13} />
              <strong className="mono">{snapshot.elapsed.toFixed(1)}s</strong>
            </span>
            <span>
              <Check size={13} />
              <strong className="mono">
                {snapshot.completed}/{enabled.length}
              </strong>{' '}
              tasks
            </span>
            <div className="progress-track">
              <span
                style={{
                  width: `${enabled.length ? (snapshot.completed / enabled.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
        <div className="console-body" ref={logRef}>
          {logTab === 'events' ? (
            snapshot.logs.map((log, i) => (
              <div className={`log-line ${log.kind}`} key={i}>
                <time>{log.time.toFixed(2).padStart(6, '0')}</time>
                <span>
                  {log.kind === 'success' ? (
                    <Check size={12} />
                  ) : log.kind === 'error' ? (
                    <X size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </span>
                <span>{log.message}</span>
              </div>
            ))
          ) : latest ? (
            <div className="validation-checks">
              {latest.checks.map((c) => (
                <div className="validation-item" key={c.objectId}>
                  <span className={c.passed ? 'result-pass' : 'result-fail'}>
                    {c.passed ? <CircleCheck size={19} /> : <CircleHelp size={19} />}
                  </span>
                  <div>
                    <strong>{COLORS[c.objectId].name}</strong>
                    <span>{c.target}</span>
                  </div>
                  <span className="mono">{c.errorMm} mm</span>
                  <span className={c.passed ? 'pass-tag' : 'fail-tag'}>
                    {c.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="validation-empty">
              <CircleDot size={16} />
              No validation results for the current layout.
            </div>
          )}
        </div>
      </section>
      <footer className="status-bar">
        <span>
          <span className="status-dot" />
          Simulation ready<span className="status-separator">/</span>Rigid-body physics
        </span>
        <span>
          Robot Task Lab<span className="status-separator">/</span>Browser edition{' '}
          <span className="mono">0.1</span>
        </span>
      </footer>

      {toast && (
        <div className="toast" role="status">
          <CircleDot size={15} />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {modal === 'library' && (
        <Modal title="Lab library" close={() => setModal(null)} wide>
          <div className="library-intro">
            <span className="eyebrow">ROBOT MANIPULATION</span>
            <p>One workcell. Three challenges.</p>
          </div>
          <div className="library-list">
            {Object.values(MISSIONS).map((m) => (
              <button
                className={`library-item ${m.id === project.mission ? 'current' : ''}`}
                key={m.id}
                onClick={() => {
                  if (m.id !== project.mission) {
                    const next = createProject(m.id);
                    update(next);
                    setSelectedStep(next.steps[0].id);
                  }
                  setModal(null);
                  setMobileView('scene');
                }}
              >
                <div className={`mini-scene ${m.id}`}>
                  <span className="mini-base" />
                  <i className="mini-block one" />
                  <i className="mini-block two" />
                  <i className="mini-block three" />
                  {m.id !== 'stack' && (
                    <>
                      <i className="mini-target one" />
                      <i className="mini-target two" />
                      <i className="mini-target three" />
                    </>
                  )}
                </div>
                <span className="library-item-body">
                  <span className="library-kicker">
                    <span className="mono">LAB {m.label}</span>
                    <span>{m.difficulty}</span>
                  </span>
                  <strong>{m.title}</strong>
                  <span>{m.description}</span>
                  <span className="library-item-action">
                    {m.id === project.mission ? 'Current lab' : 'Open lab'}
                    {m.id === project.mission ? <Check size={14} /> : <ArrowRight size={14} />}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === 'export' && (
        <Modal title="Export project" close={() => setModal(null)} wide>
          <div className="export-tabs">
            <button
              className={exportFormat === 'json' ? 'active' : ''}
              onClick={() => setExportFormat('json')}
            >
              <FileJson size={16} />
              Project JSON
            </button>
            <button
              className={exportFormat === 'python' ? 'active' : ''}
              onClick={() => setExportFormat('python')}
            >
              <Code2 size={16} />
              Python recipe
            </button>
          </div>
          <div className="code-heading">
            <span className="mono">
              {exportFormat === 'json' ? 'robot-task.json' : 'robot_task.py'}
            </span>
            <IconButton
              label="Copy exported code"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(exportText);
                  notify('Copied to clipboard.');
                } catch {
                  notify('Clipboard unavailable. Use Download instead.');
                }
              }}
            >
              <Copy size={15} />
            </IconButton>
          </div>
          <pre className="export-code">
            <code>{exportText}</code>
          </pre>
          <footer className="modal-footer">
            <span>
              {exportFormat === 'json' ? 'Portable project file' : 'Python 3.10+ / Dry-run adapter'}
            </span>
            <button
              className="button primary"
              onClick={() => {
                downloadText(
                  exportFormat === 'json' ? 'robot-task.json' : 'robot_task.py',
                  exportText,
                  exportFormat === 'json' ? 'application/json' : 'text/x-python',
                );
                notify('Export downloaded.');
              }}
            >
              <Download size={15} />
              Download
            </button>
          </footer>
        </Modal>
      )}
      {modal === 'recipe' && (
        <Modal title="Build from recipe" close={() => setModal(null)}>
          <div className="recipe-content">
            <div className="recipe-summary">
              <Route size={22} />
              <span>{mission.title}</span>
              <span className="mono">3 TASKS</span>
            </div>
            <label className="field-label">
              Execution order
              <select
                value={recipeOrder}
                onChange={(e) => setRecipeOrder(e.target.value as typeof recipeOrder)}
              >
                <option value="left-to-right">Coral, mint, blue</option>
                <option value="right-to-left">Blue, mint, coral</option>
                <option value="blue-first">Blue, coral, mint</option>
              </select>
            </label>
            <div className="recipe-preview">
              {compileRecipe(project.mission, recipeOrder).map((s, i) => (
                <div key={s.id}>
                  <span className="mono">0{i + 1}</span>
                  <Swatch id={s.objectId} />
                  <span>{COLORS[s.objectId].name}</span>
                  <ArrowRight size={13} />
                  <strong>{mission.targets.find((t) => t.id === s.targetId)?.name}</strong>
                </div>
              ))}
            </div>
          </div>
          <footer className="modal-footer">
            <span>Replaces the current sequence</span>
            <button
              className="button primary"
              onClick={() => {
                const steps = compileRecipe(project.mission, recipeOrder);
                update({ ...project, steps });
                setSelectedStep(steps[0].id);
                setModal(null);
                notify('Recipe applied.');
              }}
            >
              <Check size={15} />
              Apply recipe
            </button>
          </footer>
        </Modal>
      )}
      {modal === 'about' && (
        <Modal title="Robot Task Lab" close={() => setModal(null)}>
          <div className="about-content">
            <div className="about-logo">
              <Grip size={30} />
            </div>
            <h3>Browser robotics workbench</h3>
            <div className="data-row">
              <span>Edition</span>
              <strong>Local preview 0.1</strong>
            </div>
            <div className="data-row">
              <span>Dynamics</span>
              <strong>Rigid bodies / 120 Hz</strong>
            </div>
            <div className="data-row">
              <span>Arm control</span>
              <strong>Kinematic IK</strong>
            </div>
            <div className="data-row">
              <span>Grasp model</span>
              <strong>Constrained attachment</strong>
            </div>
            <div className="data-row">
              <span>Hardware connection</span>
              <strong>Not included</strong>
            </div>
            <div className="data-row">
              <span>Project storage</span>
              <strong>This browser only</strong>
            </div>
            <div className="about-links">
              <a href="https://pmndrs.github.io/cannon-es/" target="_blank" rel="noreferrer">
                cannon-es
                <ArrowRight size={13} />
              </a>
              <a href="https://threejs.org/" target="_blank" rel="noreferrer">
                Three.js
                <ArrowRight size={13} />
              </a>
            </div>
            <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--line)' }}>
              <button
                type="button"
                className="button"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => {
                  setDismissedOnboarding(false);
                  try {
                    localStorage.removeItem('rtl_onboarding_dismissed');
                  } catch {}
                  setModal(null);
                  notify('Quick start guide hint enabled.');
                }}
              >
                <RotateCcw size={14} />
                Reopen Quick Start Guide
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
