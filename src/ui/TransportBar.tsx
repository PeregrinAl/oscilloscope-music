// Транспорт и параметры сигнала (§3.6): Play/Pause/Stop, мьют,
// основная частота обхода (логарифмический ползунок 20–2000 Гц), громкость.

import { useStore } from "../state/store";

const F_MIN = 20;
const F_MAX = 2000;

function freqToSlider(f: number): number {
  return Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN);
}

function sliderToFreq(v: number): number {
  return F_MIN * Math.pow(F_MAX / F_MIN, v);
}

export function TransportBar() {
  const playing = useStore((s) => s.playing);
  const muted = useStore((s) => s.muted);
  const signal = useStore((s) => s.project.signal);
  const { play, pause, stop, toggleMute, setSignal } = useStore.getState();

  return (
    <div className="transport">
      {playing ? (
        <button className="active" title="Пауза" onClick={pause}>
          ⏸
        </button>
      ) : (
        <button title="Играть" onClick={() => void play()}>
          ▶
        </button>
      )}
      <button title="Стоп (сброс фазы)" onClick={stop}>
        ⏹
      </button>
      <button
        className={muted ? "active" : ""}
        title="Мьют звука (картинка продолжает работать)"
        onClick={toggleMute}
      >
        {muted ? "🔇" : "🔊"}
      </button>

      <div className="t-slider">
        <label>
          <span>Частота обхода (стабильность ↔ тон)</span>
          <span>{signal.baseFrequency.toFixed(0)} Гц</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={freqToSlider(signal.baseFrequency)}
          onChange={(e) =>
            setSignal({ baseFrequency: Math.round(sliderToFreq(parseFloat(e.target.value))) })
          }
        />
      </div>

      <div className="t-slider" style={{ maxWidth: 160 }}>
        <label>
          <span>Громкость</span>
          <span>{Math.round(signal.gain * 100)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={signal.gain}
          onChange={(e) => setSignal({ gain: parseFloat(e.target.value) })}
        />
      </div>
    </div>
  );
}
