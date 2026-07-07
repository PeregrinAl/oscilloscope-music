// Настройки скопа (§3.4): интенсивность, толщина луча, послесвечение,
// цвет фосфора, сетка, режим samples/ideal.

import { useStore } from "../state/store";

export function ScopeSettingsPanel() {
  const scope = useStore((s) => s.project.scope);
  const setScope = useStore((s) => s.setScope);

  const slider = (
    label: string,
    field: "persistence" | "beamIntensity" | "beamWidth",
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string = (v) => v.toFixed(2)
  ) => (
    <div className="setting-row">
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={scope[field]}
        onChange={(e) => setScope({ [field]: parseFloat(e.target.value) })}
      />
      <span className="val">{fmt(scope[field])}</span>
    </div>
  );

  return (
    <div className="panel">
      <h2>Скоп</h2>
      {slider("Яркость", "beamIntensity", 0.05, 3, 0.01)}
      {slider("Луч", "beamWidth", 0.4, 5, 0.05)}
      {slider("Послесвечение", "persistence", 0.3, 0.995, 0.001)}
      <div className="setting-row">
        <label>Фосфор</label>
        <input
          type="color"
          value={scope.phosphorColor}
          onChange={(e) => setScope({ phosphorColor: e.target.value })}
        />
        <button className="small" onClick={() => setScope({ phosphorColor: "#33ff66" })}>
          P31
        </button>
      </div>
      <div className="setting-row">
        <label>Сетка</label>
        <input
          type="checkbox"
          checked={scope.grid}
          onChange={(e) => setScope({ grid: e.target.checked })}
        />
      </div>
      <div className="setting-row">
        <label title="Отладочный режим: сглаженная аналитическая кривая вместо реальных сэмплов">
          Идеальная кривая
        </label>
        <input
          type="checkbox"
          checked={scope.mode === "ideal"}
          onChange={(e) => setScope({ mode: e.target.checked ? "ideal" : "samples" })}
        />
      </div>
    </div>
  );
}
