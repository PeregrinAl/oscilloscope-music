// AudioWorkletProcessor — единственный генератор стерео-сигнала (§5.2 ТЗ).
// L = x(p, vars), R = y(p, vars); p — фаза обхода фигуры [0,1).
// Сэмплы уходят одновременно в аудио-выход и в кольцевой буфер (SAB) для скопа —
// «что видишь = что слышишь» (§4.1). Fallback без SAB — postMessage блоками.
//
// Файл самостоятельный (без import) — грузится через audioWorklet.addModule.

class XYProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fx = null; // (t, v) => number
    this.fy = null;

    // Спецификации переменных: { name, value, min, max, animation:{mode,period,loop} }
    this.varSpecs = [];
    // Текущие сглаженные значения (анти-щелчок при движении ползунка)
    this.varsSmooth = {};
    // Объект, передаваемый в fx/fy (переиспользуется, чтобы не аллоцировать в горячем цикле)
    this.varsArg = { T: 0 };

    this.baseFreqTarget = 220;
    this.baseFreq = 220;
    this.gainTarget = 0.8;
    this.gain = 0.8;

    this.playing = false;
    this.muted = false;

    this.phase = 0; // фаза обхода [0,1)
    this.sampleIndex = 0; // глобальный счётчик сэмплов -> T

    // SAB-кольцо: header Int32Array [writeIndex(frames)], data Float32Array (L,R interleaved)
    this.ringHeader = null;
    this.ringData = null;
    this.ringFrames = 0;

    // Fallback: копим блок и шлём postMessage
    this.fbBuf = new Float32Array(1024 * 2);
    this.fbFill = 0;
    this.useSab = false;

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case "code": {
        // Ошибочный код не должен ронять воркилет — оставляем старые функции (§8)
        try {
          const fx = new Function("t", "v", msg.x);
          const fy = new Function("t", "v", msg.y);
          fx(0, this.varsArg);
          fy(0, this.varsArg);
          this.fx = fx;
          this.fy = fy;
        } catch (err) {
          this.port.postMessage({ type: "codeError", error: String(err) });
        }
        break;
      }
      case "vars":
        this.varSpecs = msg.specs;
        break;
      case "signal":
        this.baseFreqTarget = msg.baseFrequency;
        this.gainTarget = msg.gain;
        break;
      case "transport":
        if (msg.playing !== undefined) this.playing = msg.playing;
        break;
      case "reset":
        this.phase = 0;
        this.sampleIndex = 0;
        break;
      case "sab":
        this.ringHeader = new Int32Array(msg.sab, 0, 2);
        this.ringData = new Float32Array(msg.sab, 8);
        this.ringFrames = this.ringData.length / 2;
        this.useSab = true;
        break;
    }
  }

  // Значение переменной в момент времени T с учётом анимации (§3.2)
  targetValue(spec, T) {
    const a = spec.animation;
    if (!a || a.mode === "none") return spec.value;
    const span = spec.max - spec.min;
    const P = Math.max(0.05, a.period);
    if (a.mode === "ramp") {
      if (a.loop === "pingpong") {
        const q = (T / P) % 2;
        const u = q < 1 ? q : 2 - q;
        return spec.min + span * u;
      }
      return spec.min + span * ((T / P) % 1);
    }
    if (a.mode === "lfo") {
      return spec.min + span * (0.5 + 0.5 * Math.sin((2 * Math.PI * T) / P));
    }
    return spec.value;
  }

  // Обновление сглаженных значений переменных (вызывается раз на квант — 128 сэмплов)
  updateVars(T) {
    const specs = this.varSpecs;
    const smooth = this.varsSmooth;
    const arg = this.varsArg;
    // ~3 мс сглаживание при 48к/квант 128: k = 1 - exp(-dt/tau)
    const k = 0.6;
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const target = this.targetValue(s, T);
      let cur = smooth[s.name];
      if (cur === undefined || !isFinite(cur)) cur = target;
      // Анимируемые значения не сглаживаем повторно (они уже непрерывны),
      // сглаживаем только ручные скачки ползунка
      cur = cur + (target - cur) * k;
      if (Math.abs(cur - target) < 1e-9) cur = target;
      smooth[s.name] = cur;
      arg[s.name] = cur;
    }
    arg.T = T;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    const n = L.length;
    const sr = sampleRate;

    if (!this.playing || !this.fx || !this.fy) {
      // Тишина; фазу не двигаем — пауза «замораживает» картинку
      for (let i = 0; i < n; i++) {
        L[i] = 0;
        R[i] = 0;
      }
      return true;
    }

    const T = this.sampleIndex / sr;
    this.updateVars(T);
    const v = this.varsArg;

    // Сглаживание частоты и громкости — без щелчков (§3.1, §8)
    this.baseFreq += (this.baseFreqTarget - this.baseFreq) * 0.2;
    this.gain += (this.gainTarget - this.gain) * 0.2;

    const dp = this.baseFreq / sr;
    let phase = this.phase;
    const fx = this.fx;
    const fy = this.fy;
    const g = this.gain;

    let prevX = this.lastX || 0;
    let prevY = this.lastY || 0;

    for (let i = 0; i < n; i++) {
      let x = 0;
      let y = 0;
      try {
        x = fx(phase, v);
        y = fy(phase, v);
      } catch (e) {
        x = prevX;
        y = prevY;
      }
      // Защита от NaN/Inf и клэмп (§4.5): луч не «улетает», звук не щёлкает
      if (!isFinite(x)) x = prevX;
      if (!isFinite(y)) y = prevY;
      if (x > 1) x = 1;
      else if (x < -1) x = -1;
      if (y > 1) y = 1;
      else if (y < -1) y = -1;

      prevX = x;
      prevY = y;

      L[i] = x * g;
      R[i] = y * g;

      phase += dp;
      if (phase >= 1) phase -= 1;
    }

    this.phase = phase;
    this.sampleIndex += n;
    this.lastX = prevX;
    this.lastY = prevY;

    // --- Отдаём те же сэмплы скопу ---
    if (this.useSab && this.ringHeader) {
      const data = this.ringData;
      const frames = this.ringFrames;
      let w = Atomics.load(this.ringHeader, 0);
      for (let i = 0; i < n; i++) {
        const idx = (w % frames) * 2;
        data[idx] = L[i];
        data[idx + 1] = R[i];
        w++;
      }
      Atomics.store(this.ringHeader, 0, w);
    } else {
      // Fallback: блоками через postMessage
      const buf = this.fbBuf;
      for (let i = 0; i < n; i++) {
        buf[this.fbFill * 2] = L[i];
        buf[this.fbFill * 2 + 1] = R[i];
        this.fbFill++;
        if (this.fbFill * 2 === buf.length) {
          this.port.postMessage({ type: "samples", data: buf.slice(0, this.fbFill * 2) });
          this.fbFill = 0;
        }
      }
    }

    // Мьют реализован GainNode'ом в основном графе (после AnalyserNode'ов),
    // поэтому визуал и DSP-панели продолжают работать при выключенном звуке (§3.6)
    return true;
  }
}

registerProcessor("xy-processor", XYProcessor);
