// DSP-панели (§3.5): осциллограммы L и R по времени + спектр (FFT)
// через AnalyserNode. Сворачиваемые, не мешают основному скопу.

import { useEffect, useRef } from "react";
import { audioEngine } from "../audio/engine";
import { useStore } from "../state/store";

function drawWave(ctx: CanvasRenderingContext2D, data: Float32Array, color: string) {
  const { width: w, height: h } = ctx.canvas;
  ctx.fillStyle = "#050705";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(125,163,125,0.25)";
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * w;
    const y = h / 2 - data[i] * (h / 2 - 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  dataL: Uint8Array,
  dataR: Uint8Array,
  color: string
) {
  const { width: w, height: h } = ctx.canvas;
  ctx.fillStyle = "#050705";
  ctx.fillRect(0, 0, w, h);
  // Показываем нижнюю половину спектра (до Fs/4) — там вся жизнь
  const n = Math.floor(dataL.length / 2);
  const bw = w / n;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  for (let i = 0; i < n; i++) {
    const m = Math.max(dataL[i], dataR[i]) / 255;
    const bh = m * (h - 2);
    ctx.fillRect(i * bw, h - bh, Math.max(bw - 0.5, 0.5), bh);
  }
  ctx.globalAlpha = 1;
}

export function DspPanels() {
  const waveLRef = useRef<HTMLCanvasElement>(null);
  const waveRRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const phosphor = useStore((s) => s.project.scope.phosphorColor);
  const phosphorRef = useRef(phosphor);
  phosphorRef.current = phosphor;

  useEffect(() => {
    let raf = 0;
    const timeL = new Float32Array(2048);
    const timeR = new Float32Array(2048);
    const freqL = new Uint8Array(1024);
    const freqR = new Uint8Array(1024);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const { analyserL, analyserR } = audioEngine;
      const cl = waveLRef.current?.getContext("2d");
      const cr = waveRRef.current?.getContext("2d");
      const cs = specRef.current?.getContext("2d");
      if (!cl || !cr || !cs) return;
      const color = phosphorRef.current;
      if (analyserL && analyserR) {
        analyserL.getFloatTimeDomainData(timeL);
        analyserR.getFloatTimeDomainData(timeR);
        analyserL.getByteFrequencyData(freqL);
        analyserR.getByteFrequencyData(freqR);
      } else {
        timeL.fill(0);
        timeR.fill(0);
        freqL.fill(0);
        freqR.fill(0);
      }
      drawWave(cl, timeL, color);
      drawWave(cr, timeR, color);
      drawSpectrum(cs, freqL, freqR, color);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="dsp-panels">
      <details className="collapsible" open>
        <summary>DSP: осциллограммы L / R и спектр</summary>
        <div className="dsp-grid">
          <div className="dsp-cell">
            <div className="dsp-title">L — x(t)</div>
            <canvas ref={waveLRef} width={400} height={90} />
          </div>
          <div className="dsp-cell">
            <div className="dsp-title">R — y(t)</div>
            <canvas ref={waveRRef} width={400} height={90} />
          </div>
          <div className="dsp-cell">
            <div className="dsp-title">Спектр (FFT)</div>
            <canvas ref={specRef} width={400} height={90} />
          </div>
        </div>
      </details>
    </div>
  );
}
