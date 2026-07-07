// Экспорт WAV: офлайн-рендер стерео-сигнала (16-бит PCM).
// Логика генерации зеркалит public/xy-worklet.js: фаза обхода, обновление
// анимированных переменных раз в 128 сэмплов, клэмп и NaN-защита —
// файл звучит и рисует ровно то же, что приложение (отсчёт от T=0).

import type { Project } from "./project";
import type { CompiledPair } from "../state/store";
import { animatedValue } from "./anim";

const QUANTUM = 128;

export function renderWav(
  project: Project,
  compiled: CompiledPair,
  seconds: number,
  sampleRate = 48000
): Blob {
  if (!compiled.x || !compiled.y) throw new Error("Формулы не скомпилированы");
  const fx = compiled.x.fn;
  const fy = compiled.y.fn;
  const frames = Math.floor(Math.min(Math.max(seconds, 0.1), 600) * sampleRate);
  const g = project.signal.gain;
  const dp = project.signal.baseFrequency / sampleRate;

  const pcm = new Int16Array(frames * 2);
  const vars: Record<string, number> = { T: 0 };
  let phase = 0;
  let lastX = 0;
  let lastY = 0;

  for (let q = 0; q < frames; q += QUANTUM) {
    const T = q / sampleRate;
    vars.T = T;
    for (const v of project.variables) vars[v.name] = animatedValue(v, T);
    const end = Math.min(q + QUANTUM, frames);
    for (let i = q; i < end; i++) {
      let x = 0;
      let y = 0;
      try {
        x = fx(phase, vars);
        y = fy(phase, vars);
      } catch {
        x = lastX;
        y = lastY;
      }
      if (!isFinite(x)) x = lastX;
      if (!isFinite(y)) y = lastY;
      if (x > 1) x = 1;
      else if (x < -1) x = -1;
      if (y > 1) y = 1;
      else if (y < -1) y = -1;
      lastX = x;
      lastY = y;
      pcm[i * 2] = Math.round(x * g * 32767);
      pcm[i * 2 + 1] = Math.round(y * g * 32767);
      phase += dp;
      if (phase >= 1) phase -= 1;
    }
  }

  // RIFF/WAVE заголовок (44 байта), PCM 16 бит, 2 канала
  const dataSize = pcm.byteLength;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  dv.setUint32(4, 36 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true); // размер fmt-чанка
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 2, true); // стерео
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 4, true); // байт/с (2 канала × 2 байта)
  dv.setUint16(32, 4, true); // блок-выравнивание
  dv.setUint16(34, 16, true); // бит на сэмпл
  str(36, "data");
  dv.setUint32(40, dataSize, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}
