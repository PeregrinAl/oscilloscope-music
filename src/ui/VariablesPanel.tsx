// Переменные и ползунки с анимацией (§3.2).

import { useStore } from "../state/store";
import type { Variable } from "../engine/project";
import { animatedValue } from "../engine/anim";
import { audioEngine } from "../audio/engine";
import { useEffect, useState } from "react";

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

  const numInput = (field: "min" | "max" | "step", label: string) => (
    <>
      <label>{label}</label>
      <input
        type="number"
        className="mini-input"
        value={v[field]}
        step="any"
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (isFinite(n)) setVariable(v.name, { [field]: n });
        }}
      />
    </>
  );

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
        min={v.min}
        max={v.max}
        step={v.step || "any"}
        value={animated ? shown : v.value}
        disabled={animated}
        onChange={(e) => setVariable(v.name, { value: parseFloat(e.target.value) })}
      />
      <div className="var-limits">
        {numInput("min", "min")}
        {numInput("max", "max")}
        {numInput("step", "шаг")}
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
            <input
              type="number"
              className="mini-input"
              style={{ width: 56 }}
              min={0.05}
              step={0.5}
              value={v.animation.period}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (isFinite(n) && n > 0)
                  setVariable(v.name, { animation: { ...v.animation, period: n } });
              }}
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
