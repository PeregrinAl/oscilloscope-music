// Пресеты (§3.3): встроенные + пользовательские (сохранение в localStorage —
// пожелание заказчика).

import { useState } from "react";
import { BUILTIN_PRESETS } from "../engine/presets";
import { useStore } from "../state/store";

export function PresetsPanel() {
  const loadProject = useStore((s) => s.loadProject);
  const userPresets = useStore((s) => s.userPresets);
  const saveUserPreset = useStore((s) => s.saveUserPreset);
  const deleteUserPreset = useStore((s) => s.deleteUserPreset);
  const projectName = useStore((s) => s.project.name);
  const [saveName, setSaveName] = useState("");

  const doSave = () => {
    const name = (saveName || projectName || "Мой пресет").trim();
    saveUserPreset(name);
    setSaveName("");
  };

  return (
    <div className="panel">
      <h2>Пресеты</h2>
      <div className="preset-list">
        {BUILTIN_PRESETS.map((p) => (
          <button key={p.name} onClick={() => loadProject(p)}>
            {p.name}
          </button>
        ))}
      </div>

      <h2 style={{ marginTop: 12 }}>Мои пресеты</h2>
      {userPresets.length === 0 && (
        <div className="formula-hint">Сохраните текущую фигуру, чтобы вернуться к ней позже.</div>
      )}
      <div className="preset-list">
        {userPresets.map((p, i) => (
          <div className="preset-row" key={`${p.name}-${i}`}>
            <button className="load" onClick={() => loadProject(p)}>
              {p.name}
            </button>
            <button
              className="del"
              title="Удалить пресет"
              onClick={() => deleteUserPreset(i)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="save-preset">
        <input
          className="mini-input"
          placeholder={projectName || "Название пресета"}
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSave()}
        />
        <button className="small" onClick={doSave}>
          💾 Сохранить
        </button>
      </div>
    </div>
  );
}
