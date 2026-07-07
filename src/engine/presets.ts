// Встроенные пресеты (§3.3) + пользовательские пресеты (localStorage).

import type { Project } from "./project";
import { normalizeProject } from "./project";

function preset(
  name: string,
  x: string,
  y: string,
  variables: Project["variables"],
  baseFrequency = 220
): Project {
  return normalizeProject({
    version: 1,
    name,
    signal: { baseFrequency, sampleRate: 48000, gain: 0.8 },
    variables,
    functions: { x, y },
    scope: {},
  });
}

const v = (
  name: string,
  value: number,
  min: number,
  max: number,
  step = 0.01,
  animation: any = { mode: "none", period: 6, loop: "pingpong" }
) => ({ name, value, min, max, step, animation });

export const BUILTIN_PRESETS: Project[] = [
  preset("Окружность", "cos(tau * t)", "sin(tau * t)", [], 220),

  preset("Эллипс", "a * cos(tau * t)", "b * sin(tau * t)", [
    v("a", 0.9, 0.05, 1),
    v("b", 0.5, 0.05, 1),
  ]),

  preset("Лиссажу", "sin(k * tau * t + phi)", "sin(tau * t)", [
    v("k", 1.5, 0.5, 8, 0.5),
    v("phi", 1.5708, 0, 6.2832, 0.001, { mode: "lfo", period: 9, loop: "loop" }),
  ]),

  preset(
    "Спираль",
    "(0.08 + 0.92 * t) * cos(n * tau * t)",
    "(0.08 + 0.92 * t) * sin(n * tau * t)",
    [v("n", 8, 1, 24, 1)],
    110
  ),

  preset(
    "Роза r = cos(k·θ)",
    "cos(k * tau * t) * cos(tau * t)",
    "cos(k * tau * t) * sin(tau * t)",
    [v("k", 3, 1, 12, 0.5, { mode: "ramp", period: 14, loop: "pingpong" })],
    180
  ),

  preset(
    "Гармонограф",
    "sin(a * tau * t + phi) * exp(-d * t)",
    "sin(b * tau * t) * exp(-d * t)",
    [
      v("a", 5, 1, 12, 1),
      v("b", 4, 1, 12, 1),
      v("d", 1.2, 0, 4, 0.01),
      v("phi", 0.7854, 0, 6.2832, 0.001, { mode: "lfo", period: 11, loop: "loop" }),
    ],
    60
  ),

  preset(
    "Многоугольник / звезда",
    "0.9 * cos(pi/n) / cos(mod(tau * t, tau/n) - pi/n) * cos(tau * t)",
    "0.9 * cos(pi/n) / cos(mod(tau * t, tau/n) - pi/n) * sin(tau * t)",
    [v("n", 5, 3, 12, 1)],
    200
  ),

  preset(
    "Восьмёрка (Лиссажу 2:1)",
    "sin(2 * tau * t)",
    "sin(tau * t + phi)",
    [v("phi", 0, 0, 6.2832, 0.001, { mode: "ramp", period: 12, loop: "loop" })],
    240
  ),
];

// --- Пользовательские пресеты (пожелание заказчика: сохранение своих фигур) ---

const LS_KEY = "xy-scope-user-presets-v1";

export function loadUserPresets(): Project[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizeProject);
  } catch {
    return [];
  }
}

export function saveUserPresets(presets: Project[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(presets));
  } catch {
    // квота/приватный режим — молча игнорируем, UI покажет актуальный стейт
  }
}
