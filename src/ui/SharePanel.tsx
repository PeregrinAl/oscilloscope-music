// Сохранение/шаринг проекта (§5.4, §6): ссылка с сериализованным JSON
// в хэше URL, экспорт/импорт файла .json.

import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { normalizeProject, projectToUrlHash } from "../engine/project";
import { renderWav } from "../engine/wav";
import { NumField } from "./NumField";

export function SharePanel() {
  const project = useStore((s) => s.project);
  const compiled = useStore((s) => s.compiled);
  const loadProject = useStore((s) => s.loadProject);
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [wavSeconds, setWavSeconds] = useState(10);

  const copyLink = async () => {
    const hash = projectToUrlHash(project);
    history.replaceState(null, "", hash);
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard может быть недоступен — ссылка уже в адресной строке
    }
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name || "xy-project"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        loadProject(normalizeProject(JSON.parse(String(reader.result))));
      } catch {
        alert("Не удалось прочитать файл проекта");
      }
    };
    reader.readAsText(file);
  };

  const downloadWav = () => {
    try {
      const blob = renderWav(project, compiled, wavSeconds);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${project.name || "xy-project"}.wav`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      alert(e.message || String(e));
    }
  };

  return (
    <div className="panel">
      <h2>Проект</h2>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="small" onClick={() => void copyLink()}>
          {copied ? "✓ Скопировано" : "🔗 Ссылка"}
        </button>
        <button className="small" onClick={downloadJson}>
          ⬇ JSON
        </button>
        <button className="small" onClick={() => fileRef.current?.click()}>
          ⬆ Импорт
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importJson(f);
            e.target.value = "";
          }}
        />
      </div>
      <div
        className="setting-row"
        style={{ marginTop: 10, marginBottom: 0 }}
        title="Офлайн-рендер того же сигнала с начала (T=0): анимации переменных попадут в файл"
      >
        <label>WAV, сек</label>
        <NumField
          style={{ width: 56 }}
          value={wavSeconds}
          accept={(n) => n > 0 && n <= 600}
          onCommit={setWavSeconds}
        />
        <button className="small" disabled={!compiled.x || !compiled.y} onClick={downloadWav}>
          ⬇ Экспорт WAV
        </button>
      </div>
    </div>
  );
}
