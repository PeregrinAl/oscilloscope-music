// Значение переменной с учётом анимации (§3.2).
// Зеркалит логику из public/xy-worklet.js (targetValue) — используется
// рендером в режиме «идеальная кривая», чтобы картинка совпадала.

import type { Variable } from "./project";

export function animatedValue(v: Variable, T: number): number {
  const a = v.animation;
  if (!a || a.mode === "none") return v.value;
  const span = v.max - v.min;
  const P = Math.max(0.05, a.period);
  if (a.mode === "ramp") {
    if (a.loop === "pingpong") {
      const q = (T / P) % 2;
      const u = q < 1 ? q : 2 - q;
      return v.min + span * u;
    }
    return v.min + span * ((T / P) % 1);
  }
  if (a.mode === "lfo") {
    return v.min + span * (0.5 + 0.5 * Math.sin((2 * Math.PI * T) / P));
  }
  return v.value;
}
