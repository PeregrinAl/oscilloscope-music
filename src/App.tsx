import { useEffect, useState } from "react";
import { Scope } from "./ui/Scope";
import { FunctionEditor } from "./ui/FunctionEditor";
import { VariablesPanel } from "./ui/VariablesPanel";
import { PresetsPanel } from "./ui/PresetsPanel";
import { TransportBar } from "./ui/TransportBar";
import { ScopeSettingsPanel } from "./ui/ScopeSettingsPanel";
import { DspPanels } from "./ui/DspPanels";
import { SharePanel } from "./ui/SharePanel";
import { useStore } from "./state/store";
import { audioEngine } from "./audio/engine";

export function App() {
  const name = useStore((s) => s.project.name);
  const setName = useStore((s) => s.setName);
  const started = useStore((s) => s.started);
  const [sabBadge, setSabBadge] = useState<string | null>(null);

  useEffect(() => {
    if (started) {
      setSabBadge(audioEngine.usingSab ? "SAB" : "fallback");
    }
  }, [started]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>XY SCOPE</h1>
        <input
          className="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          title="Название проекта"
        />
        <div className="spacer" />
        {sabBadge && (
          <span
            className="badge"
            title={
              sabBadge === "SAB"
                ? "Сэмплы идут в скоп через SharedArrayBuffer"
                : "SharedArrayBuffer недоступен — работает fallback через postMessage"
            }
          >
            {sabBadge}
          </span>
        )}
        <span className="badge">картинка = звук</span>
      </header>

      <aside className="sidebar left">
        <FunctionEditor />
        <VariablesPanel />
        <PresetsPanel />
      </aside>

      <main className="center">
        <div className="scope-wrap">
          <Scope />
        </div>
        <TransportBar />
        <DspPanels />
      </main>

      <aside className="sidebar right">
        <ScopeSettingsPanel />
        <SharePanel />
      </aside>
    </div>
  );
}
