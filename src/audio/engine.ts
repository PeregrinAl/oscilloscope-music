// Audio Engine (§5.2): AudioContext + AudioWorklet + граф анализа.
// Граф: worklet -> [splitter -> analyserL/R] -> muteGain -> destination.
// Сэмплы для скопа идут из воркилета через SAB-кольцо (или postMessage-fallback).

import type { Variable } from "../engine/project";

const RING_FRAMES = 32768; // ~0.68 c при 48 кГц

export interface SampleSource {
  /**
   * Читает новые кадры (пары L,R) начиная с внутреннего курсора.
   * Возвращает количество прочитанных кадров, записанных в out (interleaved LR).
   */
  readNew(out: Float32Array): number;
}

class SabSampleSource implements SampleSource {
  private header: Int32Array;
  private data: Float32Array;
  private frames: number;
  private cursor = 0;

  constructor(sab: SharedArrayBuffer) {
    this.header = new Int32Array(sab, 0, 2);
    this.data = new Float32Array(sab, 8);
    this.frames = this.data.length / 2;
  }

  readNew(out: Float32Array): number {
    const w = Atomics.load(this.header, 0);
    let available = w - this.cursor;
    if (available <= 0) return 0;
    // Отстали больше чем на буфер — догоняем (берём только свежий хвост)
    if (available > this.frames) {
      this.cursor = w - this.frames;
      available = this.frames;
    }
    const maxFrames = out.length / 2;
    // Берём самый свежий кусок, влезающий в out
    if (available > maxFrames) {
      this.cursor = w - maxFrames;
      available = maxFrames;
    }
    for (let i = 0; i < available; i++) {
      const idx = ((this.cursor + i) % this.frames) * 2;
      out[i * 2] = this.data[idx];
      out[i * 2 + 1] = this.data[idx + 1];
    }
    this.cursor = w;
    return available;
  }
}

class MessageSampleSource implements SampleSource {
  private queue: Float32Array[] = [];
  private queuedFrames = 0;

  push(block: Float32Array) {
    this.queue.push(block);
    this.queuedFrames += block.length / 2;
    // Не даём очереди расти бесконечно при скрытой вкладке
    while (this.queuedFrames > RING_FRAMES) {
      const dropped = this.queue.shift()!;
      this.queuedFrames -= dropped.length / 2;
    }
  }

  readNew(out: Float32Array): number {
    let written = 0;
    const maxFrames = out.length / 2;
    while (this.queue.length > 0 && written < maxFrames) {
      const block = this.queue[0];
      const blockFrames = block.length / 2;
      if (written + blockFrames <= maxFrames) {
        out.set(block, written * 2);
        written += blockFrames;
        this.queue.shift();
        this.queuedFrames -= blockFrames;
      } else {
        const take = maxFrames - written;
        out.set(block.subarray(0, take * 2), written * 2);
        this.queue[0] = block.slice(take * 2);
        this.queuedFrames -= take;
        written += take;
      }
    }
    return written;
  }
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private muteGain: GainNode | null = null;
  analyserL: AnalyserNode | null = null;
  analyserR: AnalyserNode | null = null;
  sampleSource: SampleSource | null = null;
  usingSab = false;
  onCodeError: ((err: string) => void) | null = null;

  // Отложенные сообщения, отправленные до init()
  private pending: any[] = [];

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  async init(): Promise<void> {
    if (this.ctx) return;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.audioWorklet.addModule("/xy-worklet.js");
    const node = new AudioWorkletNode(ctx, "xy-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Анализ: сплиттер на два AnalyserNode (осциллограммы L/R + спектр, §3.5)
    const splitter = ctx.createChannelSplitter(2);
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    analyserL.fftSize = 2048;
    analyserR.fftSize = 2048;
    node.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    const muteGain = ctx.createGain();
    node.connect(muteGain);
    muteGain.connect(ctx.destination);

    // Канал сэмплов для скопа: SAB, если есть кросс-ориджин изоляция (§5.3)
    if (typeof SharedArrayBuffer !== "undefined" && crossOriginIsolated) {
      const sab = new SharedArrayBuffer(8 + RING_FRAMES * 2 * 4);
      node.port.postMessage({ type: "sab", sab });
      this.sampleSource = new SabSampleSource(sab);
      this.usingSab = true;
    } else {
      const src = new MessageSampleSource();
      this.sampleSource = src;
      this.usingSab = false;
      node.port.onmessage = (e) => {
        if (e.data.type === "samples") src.push(e.data.data);
        else if (e.data.type === "codeError") this.onCodeError?.(e.data.error);
      };
    }
    if (this.usingSab) {
      node.port.onmessage = (e) => {
        if (e.data.type === "codeError") this.onCodeError?.(e.data.error);
      };
    }

    this.ctx = ctx;
    this.node = node;
    this.muteGain = muteGain;
    this.analyserL = analyserL;
    this.analyserR = analyserR;

    for (const msg of this.pending) node.port.postMessage(msg);
    this.pending = [];
  }

  private post(msg: any) {
    if (this.node) this.node.port.postMessage(msg);
    else this.pending.push(msg);
  }

  /** Отправляет скомпилированные тела функций x/y в воркилет */
  setCode(xBody: string, yBody: string) {
    this.post({ type: "code", x: xBody, y: yBody });
  }

  setVariables(vars: Variable[]) {
    // Передаём только то, что нужно воркилету
    this.post({
      type: "vars",
      specs: vars.map((v) => ({
        name: v.name,
        value: v.value,
        min: v.min,
        max: v.max,
        animation: v.animation,
      })),
    });
  }

  setSignal(baseFrequency: number, gain: number) {
    this.post({ type: "signal", baseFrequency, gain });
  }

  async setPlaying(playing: boolean) {
    if (playing) {
      await this.init();
      await this.ctx!.resume();
    }
    this.post({ type: "transport", playing });
  }

  /** Сброс фазы обхода и глобального времени (кнопка Stop) */
  reset() {
    this.post({ type: "reset" });
  }

  setMuted(muted: boolean) {
    if (this.muteGain && this.ctx) {
      // Плавно за 15 мс — без щелчка
      this.muteGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.015);
    }
  }
}

// Синглтон движка на приложение
export const audioEngine = new AudioEngine();
