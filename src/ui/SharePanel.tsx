// Сохранение/шаринг проекта (§5.4, §6): ссылка с сериализованным JSON
// в хэше URL, экспорт/импорт файла .json.

import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { normalizeProject, projectToUrlHash } from "../engine/project";

export function SharePanel() {
  const project = useStore((s) => s.project);
  const loadProject = useStore((s) => s.loadProject);
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

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
    </div>
  );
}
