// Компонент скопа: канвас + рендер-цикл.
// Режим samples (по умолчанию): рисуем ровно те сэмплы, что генерирует
// AudioWorklet (§4.1, §4.3). Режим ideal: аналитическая кривая (отладка, §3.4).

import { useEffect, useRef } from "react";
import { ScopeRenderer } from "../render/scope";
import { audioEngine } from "../audio/engine";
import { useStore } from "../state/store";
import { animatedValue } from "../engine/anim";

const READ_CAP = 8192; // кадров за раз (пар L,R)
const IDEAL_POINTS = 2048;

export function Scope() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const started = useStore((s) => s.started);
  const play = useStore((s) => s.play);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: ScopeRenderer;
    try {
      renderer = new ScopeRenderer(canvas, useStore.getState().project.scope);
    } catch (e) {
      console.error(e);
      return;
    }

    const readBuf = new Float32Array(READ_CAP * 2);
    const idealBuf = new Float32Array((IDEAL_POINTS + 1) * 2);
    let raf = 0;
    let lastT = performance.now();
    let disposed = false;

    const ro = new ResizeObserver(() => renderer.resize());
    ro.observe(canvas);

    const loop = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;

      const state = useStore.getState();
      renderer.settings = state.project.scope;

      if (state.project.scope.mode === "ideal") {
        // Отладочный режим: аналитическая кривая, один полный обход за кадр
        const { compiled, project, playing } = state;
        if (playing && compiled.x && compiled.y) {
          const T = audioEngine.ctx?.currentTime ?? now / 1000;
          const vars: Record<string, number> = { T };
          for (const v of project.variables) vars[v.name] = animatedValue(v, T);
          let ok = true;
          for (let i = 0; i <= IDEAL_POINTS; i++) {
            const t = i / IDEAL_POINTS;
            let x = 0;
            let y = 0;
            try {
              x = compiled.x.fn(t, vars);
              y = compiled.y.fn(t, vars);
            } catch {
              ok = false;
              break;
            }
            if (!isFinite(x)) x = 0;
            if (!isFinite(y)) y = 0;
            idealBuf[i * 2] = Math.max(-1, Math.min(1, x)) * project.signal.gain;
            idealBuf[i * 2 + 1] = Math.max(-1, Math.min(1, y)) * project.signal.gain;
          }
          renderer.frame(idealBuf, ok ? IDEAL_POINTS + 1 : 0, dt, true);
        } else {
          renderer.frame(idealBuf, 0, dt, true);
        }
      } else {
        // Основной режим: реальные сэмплы из воркилета
        const src = audioEngine.sampleSource;
        const frames = src ? src.readNew(readBuf) : 0;
        renderer.frame(readBuf, frames, dt);
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="scope-frame">
      <canvas ref={canvasRef} />
      {!started && (
        <div className="scope-overlay" onClick={() => void play()}>
          <button>▶ Запустить</button>
          <div className="hint">Звук в браузере требует клика — это одно нажатие</div>
        </div>
      )}
    </div>
  );
}
