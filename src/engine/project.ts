// Модель данных проекта (§6 ТЗ) + сериализация для сохранения/шаринга.

export type AnimationMode = "none" | "ramp" | "lfo";
export type LoopMode = "loop" | "pingpong";
export type ScopeMode = "samples" | "ideal";

export interface VariableAnimation {
  mode: AnimationMode;
  /** Период анимации в секундах */
  period: number;
  /** Для ramp: loop | pingpong */
  loop: LoopMode;
}

export interface Variable {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  animation: VariableAnimation;
}

export interface ScopeSettings {
  phosphorColor: string;
  /** Послесвечение: множитель яркости за кадр при 60 fps, 0..1 */
  persistence: number;
  beamIntensity: number;
  beamWidth: number;
  grid: boolean;
  mode: ScopeMode;
}

export interface SignalSettings {
  /** Основная частота обхода фигуры, Гц (§3.6) */
  baseFrequency: number;
  sampleRate: number;
  gain: number;
}

export interface Project {
  version: 1;
  name: string;
  signal: SignalSettings;
  variables: Variable[];
  functions: { x: string; y: string };
  scope: ScopeSettings;
}

export const DEFAULT_SCOPE: ScopeSettings = {
  phosphorColor: "#33ff66",
  persistence: 0.88,
  beamIntensity: 1.0,
  beamWidth: 1.2,
  grid: true,
  mode: "samples",
};

export const DEFAULT_SIGNAL: SignalSettings = {
  baseFrequency: 220,
  sampleRate: 48000,
  gain: 0.8,
};

export function defaultProject(): Project {
  return {
    version: 1,
    name: "Лиссажу 3:2",
    signal: { ...DEFAULT_SIGNAL },
    variables: [
      {
        name: "k",
        value: 1.5,
        min: 0.5,
        max: 8,
        step: 0.01,
        animation: { mode: "none", period: 6, loop: "pingpong" },
      },
      {
        name: "phi",
        value: Math.PI / 2,
        min: 0,
        max: 6.2832,
        step: 0.001,
        animation: { mode: "lfo", period: 8, loop: "loop" },
      },
    ],
    functions: { x: "sin(k * tau * t + phi)", y: "sin(tau * t)" },
    scope: { ...DEFAULT_SCOPE },
  };
}

/** Заполняет отсутствующие поля дефолтами — устойчивость к старым/битым JSON. */
export function normalizeProject(raw: any): Project {
  const d = defaultProject();
  if (!raw || typeof raw !== "object") return d;
  const num = (v: any, fb: number) => (typeof v === "number" && isFinite(v) ? v : fb);
  const vars: Variable[] = Array.isArray(raw.variables)
    ? raw.variables
        .filter((v: any) => v && typeof v.name === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v.name))
        .map((v: any) => ({
          name: v.name,
          value: num(v.value, 0),
          min: num(v.min, 0),
          max: num(v.max, 1),
          step: num(v.step, 0.01),
          animation: {
            mode: ["none", "ramp", "lfo"].includes(v.animation?.mode) ? v.animation.mode : "none",
            period: Math.max(0.05, num(v.animation?.period, 4)),
            loop: v.animation?.loop === "loop" ? "loop" : "pingpong",
          },
        }))
    : d.variables;
  return {
    version: 1,
    name: typeof raw.name === "string" ? raw.name : d.name,
    signal: {
      baseFrequency: Math.min(2000, Math.max(1, num(raw.signal?.baseFrequency, d.signal.baseFrequency))),
      sampleRate: num(raw.signal?.sampleRate, d.signal.sampleRate),
      gain: Math.min(1, Math.max(0, num(raw.signal?.gain, d.signal.gain))),
    },
    variables: vars,
    functions: {
      x: typeof raw.functions?.x === "string" ? raw.functions.x : d.functions.x,
      y: typeof raw.functions?.y === "string" ? raw.functions.y : d.functions.y,
    },
    scope: {
      phosphorColor:
        typeof raw.scope?.phosphorColor === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.scope.phosphorColor)
          ? raw.scope.phosphorColor
          : d.scope.phosphorColor,
      persistence: Math.min(0.999, Math.max(0, num(raw.scope?.persistence, d.scope.persistence))),
      beamIntensity: Math.min(5, Math.max(0.05, num(raw.scope?.beamIntensity, d.scope.beamIntensity))),
      beamWidth: Math.min(8, Math.max(0.3, num(raw.scope?.beamWidth, d.scope.beamWidth))),
      grid: raw.scope?.grid !== false,
      mode: raw.scope?.mode === "ideal" ? "ideal" : "samples",
    },
  };
}

// --- Сериализация в URL (шаринг, §5.4) ---

function b64encodeUtf8(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64decodeUtf8(s: string): string {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function projectToUrlHash(p: Project): string {
  return "#p=" + b64encodeUtf8(JSON.stringify(p));
}

export function projectFromUrlHash(hash: string): Project | null {
  const m = /#p=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    return normalizeProject(JSON.parse(b64decodeUtf8(m[1])));
  } catch {
    return null;
  }
}
