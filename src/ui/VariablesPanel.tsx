// Переменные и ползунки с анимацией (§3.2).

import { useStore } from "../state/store";
import type { Variable } from "../engine/project";
import { animatedValue } from "../engine/anim";
import { audioEngine } from "../audio/engine";
import { useEffect, useState } from "react";
import { NumField } from "./NumField";

function VariableCard({ v }: { v: Variable }) {
  const setVariable = useStore((s) => s.setVariable);
  const removeVariable = useStore((s) => s.removeVariable);
  const animated = v.animation.mode !== "none";

  // Живое отображение анимированного значения
  const [liveValue, setLiveValue] = useState(v.value);
  useEffect(() => {
    if (!animated) return;
    let raf = 0;
    const tick = () => {
      const T = audioEngine.ctx?.currentTime ?? performance.now() / 1000;
      setLiveValue(animatedValue(v, T));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animated, v]);

  const shown = animated ? liveValue : v.value;

  return (
    <div className="var-card">
      <div className="var-head">
        <span className="var-name">{v.name}</span>
        <span className="var-value">{shown.toFixed(3)}</span>
        <button className="del" title="Удалить переменную" onClick={() => removeVariable(v.name)}>
          ✕
        </button>
      </div>
      <input
        type="range"
        min={Math.min(v.min, v.max)}
        max={Math.max(v.min, v.max)}
        step={v.step > 0 ? v.step : "any"}
        value={animated ? shown : v.value}
        disabled={animated}
        onChange={(e) => setVariable(v.name, { value: parseFloat(e.target.value) })}
      />
      <div className="var-limits">
        <label>min</label>
        <NumField value={v.min} onCommit={(n) => setVariable(v.name, { min: n })} />
        <label>max</label>
        <NumField value={v.max} onCommit={(n) => setVariable(v.name, { max: n })} />
        <label>шаг</label>
        <NumField
          value={v.step}
          accept={(n) => n >= 0}
          onCommit={(n) => setVariable(v.name, { step: n })}
          title="0 — плавно, без сетки шага"
        />
      </div>
      <div className="var-anim">
        <select
          value={v.animation.mode}
          onChange={(e) =>
            setVariable(v.name, { animation: { ...v.animation, mode: e.target.value as any } })
          }
        >
          <option value="none">без анимации</option>
          <option value="ramp">ramp</option>
          <option value="lfo">lfo</option>
        </select>
        {animated && (
          <>
            <label style={{ color: "var(--text-dim)", fontSize: 11 }}>период, с</label>
            <NumField
              style={{ width: 56 }}
              value={v.animation.period}
              accept={(n) => n > 0}
              onCommit={(n) => setVariable(v.name, { animation: { ...v.animation, period: n } })}
            />
          </>
        )}
        {v.animation.mode === "ramp" && (
          <select
            value={v.animation.loop}
            onChange={(e) =>
              setVariable(v.name, { animation: { ...v.animation, loop: e.target.value as any } })
            }
          >
            <option value="loop">loop</option>
            <option value="pingpong">pingpong</option>
          </select>
        )}
      </div>
    </div>
  );
}

export function VariablesPanel() {
  const variables = useStore((s) => s.project.variables);
  return (
    <div className="panel">
      <h2>Переменные</h2>
      {variables.length === 0 && (
        <div className="formula-hint">
          Добавьте букву (например, <code>k</code>) в формулу — ползунок появится сам.
        </div>
      )}
      {variables.map((v) => (
        <VariableCard key={v.name} v={v} />
      ))}
    </div>
  );
}
