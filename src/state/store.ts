// UI / State (§5.4): единый стор Zustand.
// Все изменения, влияющие на сигнал, немедленно проталкиваются в AudioEngine —
// живой отклик без перезапуска звука (§3.1).

import { create } from "zustand";
import { compileExpr, isReservedName, type CompiledExpr } from "../engine/expr";
import {
  defaultProject,
  normalizeProject,
  projectFromUrlHash,
  type Project,
  type ScopeSettings,
  type Variable,
} from "../engine/project";
import { audioEngine } from "../audio/engine";
import { BUILTIN_PRESETS, loadUserPresets, saveUserPresets } from "../engine/presets";

export interface CompiledPair {
  x: CompiledExpr | null;
  y: CompiledExpr | null;
}

interface AppState {
  project: Project;
  compiled: CompiledPair;
  /** Ошибки парсинга по осям; null = ок */
  errors: { x: string | null; y: string | null };
  playing: boolean;
  muted: boolean;
  started: boolean; // был ли первый запуск аудио (жест пользователя)
  userPresets: Project[];

  setFunction(axis: "x" | "y", src: string): void;
  setVariable(name: string, patch: Partial<Variable>): void;
  removeVariable(name: string): void;
  setSignal(patch: Partial<Project["signal"]>): void;
  setScope(patch: Partial<ScopeSettings>): void;
  setName(name: string): void;
  loadProject(p: Project): void;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  toggleMute(): void;
  saveUserPreset(name: string): void;
  deleteUserPreset(index: number): void;
}

function tryCompile(src: string): { compiled: CompiledExpr | null; error: string | null } {
  try {
    return { compiled: compileExpr(src), error: null };
  } catch (e: any) {
    return { compiled: null, error: e.message || String(e) };
  }
}

/** Добавляет переменные, впервые появившиеся в формулах (Desmos-поведение) */
function withAutoVariables(project: Project, compiled: CompiledPair): Project {
  const used = new Set<string>([
    ...(compiled.x?.variables ?? []),
    ...(compiled.y?.variables ?? []),
  ]);
  const existing = new Set(project.variables.map((v) => v.name));
  const added: Variable[] = [];
  for (const name of used) {
    if (!existing.has(name) && !isReservedName(name)) {
      added.push({
        name,
        value: 1,
        min: 0,
        max: 5,
        step: 0.01,
        animation: { mode: "none", period: 6, loop: "pingpong" },
      });
    }
  }
  if (added.length === 0) return project;
  return { ...project, variables: [...project.variables, ...added] };
}

function pushAll(project: Project, compiled: CompiledPair) {
  if (compiled.x && compiled.y) {
    audioEngine.setCode(compiled.x.body, compiled.y.body);
  }
  audioEngine.setVariables(project.variables);
  audioEngine.setSignal(project.signal.baseFrequency, project.signal.gain);
}

// Начальный проект: из URL (шаринг) или дефолт
const initialProject = projectFromUrlHash(location.hash) ?? defaultProject();
const initialCompiled: CompiledPair = {
  x: tryCompile(initialProject.functions.x).compiled,
  y: tryCompile(initialProject.functions.y).compiled,
};

export const useStore = create<AppState>((set, get) => ({
  project: withAutoVariables(initialProject, initialCompiled),
  compiled: initialCompiled,
  errors: { x: null, y: null },
  playing: false,
  muted: false,
  started: false,
  userPresets: loadUserPresets(),

  setFunction(axis, src) {
    const { project, compiled, errors } = get();
    const next: Project = { ...project, functions: { ...project.functions, [axis]: src } };
    const res = tryCompile(src);
    const nextCompiled: CompiledPair = { ...compiled };
    const nextErrors = { ...errors };
    if (res.compiled) {
      nextCompiled[axis] = res.compiled;
      nextErrors[axis] = null;
    } else {
      // Ошибка: формулу в стейте обновляем (пользователь её видит и правит),
      // но в звук уходит последняя рабочая версия (§8: звук не прерывается)
      nextErrors[axis] = res.error;
    }
    const withVars = withAutoVariables(next, nextCompiled);
    set({ project: withVars, compiled: nextCompiled, errors: nextErrors });
    if (res.compiled) pushAll(withVars, nextCompiled);
  },

  setVariable(name, patch) {
    const { project } = get();
    const variables = project.variables.map((v) => (v.name === name ? { ...v, ...patch } : v));
    const next = { ...project, variables };
    set({ project: next });
    audioEngine.setVariables(variables);
  },

  removeVariable(name) {
    const { project } = get();
    const variables = project.variables.filter((v) => v.name !== name);
    const next = { ...project, variables };
    set({ project: next });
    audioEngine.setVariables(variables);
  },

  setSignal(patch) {
    const { project } = get();
    const signal = { ...project.signal, ...patch };
    set({ project: { ...project, signal } });
    audioEngine.setSignal(signal.baseFrequency, signal.gain);
  },

  setScope(patch) {
    const { project } = get();
    set({ project: { ...project, scope: { ...project.scope, ...patch } } });
  },

  setName(name) {
    set({ project: { ...get().project, name } });
  },

  loadProject(p) {
    const project = normalizeProject(p);
    const compiled: CompiledPair = {
      x: tryCompile(project.functions.x).compiled,
      y: tryCompile(project.functions.y).compiled,
    };
    const withVars = withAutoVariables(project, compiled);
    set({
      project: withVars,
      compiled,
      errors: {
        x: compiled.x ? null : "Ошибка в формуле",
        y: compiled.y ? null : "Ошибка в формуле",
      },
    });
    pushAll(withVars, compiled);
  },

  async play() {
    const { project, compiled } = get();
    await audioEngine.setPlaying(true);
    // После первой инициализации — прогнать всё состояние в воркилет
    pushAll(project, compiled);
    audioEngine.setMuted(get().muted);
    set({ playing: true, started: true });
  },

  pause() {
    void audioEngine.setPlaying(false);
    set({ playing: false });
  },

  stop() {
    void audioEngine.setPlaying(false);
    audioEngine.reset();
    set({ playing: false });
  },

  toggleMute() {
    const muted = !get().muted;
    audioEngine.setMuted(muted);
    set({ muted });
  },

  saveUserPreset(name) {
    const { project, userPresets } = get();
    const snapshot: Project = JSON.parse(JSON.stringify({ ...project, name }));
    const next = [...userPresets.filter((p) => p.name !== name), snapshot];
    saveUserPresets(next);
    set({ userPresets: next });
  },

  deleteUserPreset(index) {
    const next = get().userPresets.filter((_, i) => i !== index);
    saveUserPresets(next);
    set({ userPresets: next });
  },
}));
