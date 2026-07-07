// Renderer (§5.3, §3.4): реалистичный XY-скоп на WebGL2.
//
// Физика (адаптация подхода woscope, MIT):
//  - Каждая пара соседних сэмплов (L,R) — сегмент пути луча за 1/Fs секунды.
//  - Экспозиция точки экрана = интеграл гауссова пятна луча вдоль сегмента:
//    поперёк — гауссиана, вдоль — разность erf; делим на длину сегмента —
//    это и есть «яркость ∝ времени пребывания» (§4.4): медленный луч ярче.
//  - Аддитивное накопление в float-буфере; послесвечение — умножение
//    аккумулятора на коэффициент затухания каждый кадр; bloom — размытие
//    аккумулятора в пониженном разрешении.

import type { ScopeSettings } from "../engine/project";

const MAX_SEGMENTS = 8192;

const BEAM_VS = `#version 300 es
layout(location=0) in vec2 aQuad;   // x: 0..1 вдоль сегмента, y: -1..1 поперёк
layout(location=1) in vec2 aStart;  // NDC
layout(location=2) in vec2 aEnd;    // NDC
uniform vec2 uResolution;
uniform float uSigmaPx;
out vec2 vLocal;  // пиксельные координаты относительно начала сегмента (вдоль/поперёк)
out float vLen;   // длина сегмента, px
void main() {
  vec2 startPx = (aStart * 0.5 + 0.5) * uResolution;
  vec2 endPx   = (aEnd   * 0.5 + 0.5) * uResolution;
  vec2 d = endPx - startPx;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float m = uSigmaPx * 4.0 + 1.0;  // запас под хвосты гауссианы
  float along = mix(-m, len + m, aQuad.x);
  vec2 posPx = startPx + dir * along + nrm * (aQuad.y * m);
  vLocal = vec2(along, aQuad.y * m);
  vLen = len;
  gl_Position = vec4(posPx / uResolution * 2.0 - 1.0, 0.0, 1.0);
}`;

const BEAM_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vLen;
uniform float uSigmaPx;
uniform float uIntensity;
out vec4 frag;

// Аппроксимация erf (Abramowitz & Stegun 7.1.26)
float erf(float x) {
  float s = sign(x);
  x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
              - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}

void main() {
  float s = max(uSigmaPx, 0.3);
  float inv = 1.0 / (s * 1.41421356);
  // Покрытие вдоль сегмента: интеграл гауссианы от 0 до len
  float along = (erf(vLocal.x * inv) - erf((vLocal.x - vLen) * inv)) * 0.5;
  float cross_ = exp(-vLocal.y * vLocal.y / (2.0 * s * s));
  // Деление на длину — нормировка энергии: 1 сэмпл времени на сегмент.
  // «+ s» смягчает предел len->0 (точка) без ветвления.
  float e = uIntensity * along * cross_ / (vLen + s);
  frag = vec4(vec3(e), 1.0);
}`;

const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  // Один большой треугольник на весь экран
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

const DECAY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uDecay;
out vec4 frag;
void main() {
  vec3 c = texture(uTex, vUv).rgb * uDecay;
  // Вычитаем эпсилон, чтобы послесвечение в FP16 гарантированно гасло до нуля
  frag = vec4(max(c - 0.0001, 0.0), 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir; // (texel,0) или (0,texel)
out vec4 frag;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.2270270270;
  c += texture(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  frag = vec4(c, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uAccum;
uniform sampler2D uBloom;
uniform vec3 uColor;
uniform float uGridOn;
out vec4 frag;

void main() {
  float b = texture(uAccum, vUv).r;
  float bl = texture(uBloom, vUv).r;
  // Тонмаппинг: насыщение фосфора
  float v = 1.0 - exp(-b);
  float g = 1.0 - exp(-bl * 0.6);
  vec3 col = uColor * v;
  col += vec3(1.0) * pow(v, 4.0) * 0.45;      // белое «прожжённое» ядро
  col += uColor * g * 0.55;                    // свечение/bloom
  // Сетка-«клетка» (10 делений) — процедурно
  if (uGridOn > 0.5) {
    vec2 gv = abs(fract(vUv * 10.0 - 0.5) - 0.5) / fwidth(vUv * 10.0);
    float line = 1.0 - min(min(gv.x, gv.y), 1.0);
    vec2 av = abs(vUv - 0.5) / fwidth(vUv);
    float axis = 1.0 - min(min(av.x, av.y), 1.0);
    col += uColor * (line * 0.05 + axis * 0.06);
  }
  // Лёгкое виньетирование трубки
  float r = length(vUv - 0.5);
  col *= 1.0 - 0.35 * r * r;
  frag = vec4(col, 1.0);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error("Shader compile error: " + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("Program link error: " + gl.getProgramInfoLog(p));
  }
  return p;
}

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class ScopeRenderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private floatOk: boolean;

  private beamProg: WebGLProgram;
  private decayProg: WebGLProgram;
  private blurProg: WebGLProgram;
  private compositeProg: WebGLProgram;

  private beamVao: WebGLVertexArrayObject;
  private instanceVbo: WebGLBuffer;
  private emptyVao: WebGLVertexArrayObject;
  private instanceData = new Float32Array(MAX_SEGMENTS * 4);

  private accumA: Target | null = null;
  private accumB: Target | null = null;
  private bloomA: Target | null = null;
  private bloomB: Target | null = null;

  private lastX = 0;
  private lastY = 0;
  private hasLast = false;

  settings: ScopeSettings;

  constructor(canvas: HTMLCanvasElement, settings: ScopeSettings) {
    this.canvas = canvas;
    this.settings = settings;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 не поддерживается этим браузером");
    this.gl = gl;
    // Для аддитивного накопления HDR-яркости нужен рендер во float-текстуру
    this.floatOk = !!gl.getExtension("EXT_color_buffer_float");

    this.beamProg = createProgram(gl, BEAM_VS, BEAM_FS);
    this.decayProg = createProgram(gl, FULLSCREEN_VS, DECAY_FS);
    this.blurProg = createProgram(gl, FULLSCREEN_VS, BLUR_FS);
    this.compositeProg = createProgram(gl, FULLSCREEN_VS, COMPOSITE_FS);

    // VAO луча: статический квад + инстансные атрибуты сегментов
    const quad = new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]);
    const quadVbo = gl.createBuffer()!;
    this.instanceVbo = gl.createBuffer()!;
    this.beamVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.beamVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    this.emptyVao = gl.createVertexArray()!;

    this.resize();
  }

  private createTarget(w: number, h: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.floatOk) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.max(64, Math.round(this.canvas.clientWidth * dpr));
    if (this.canvas.width === size && this.accumA) return;
    this.canvas.width = size;
    this.canvas.height = size;
    const gl = this.gl;
    for (const t of [this.accumA, this.accumB, this.bloomA, this.bloomB]) {
      if (t) {
        gl.deleteFramebuffer(t.fb);
        gl.deleteTexture(t.tex);
      }
    }
    this.accumA = this.createTarget(size, size);
    this.accumB = this.createTarget(size, size);
    const bs = Math.max(32, size >> 2);
    this.bloomA = this.createTarget(bs, bs);
    this.bloomB = this.createTarget(bs, bs);
  }

  /**
   * Рисует кадр.
   * @param samples interleaved-пары (L,R) в [-1,1]
   * @param frames  число пар
   * @param dt      время кадра, сек
   * @param resetBeam разорвать непрерывность (только для режима ideal)
   */
  frame(samples: Float32Array, frames: number, dt: number, resetBeam = false) {
    const gl = this.gl;
    const s = this.settings;
    if (!this.accumA || !this.accumB || !this.bloomA || !this.bloomB) return;

    if (resetBeam) this.hasLast = false;

    // --- Формируем сегменты (включая соединение с последней точкой прошлого кадра —
    // луч непрерывен, §4.2) ---
    let nSeg = 0;
    const inst = this.instanceData;
    let px = this.lastX;
    let py = this.lastY;
    let has = this.hasLast;
    const maxSeg = Math.min(frames, MAX_SEGMENTS);
    for (let i = 0; i < maxSeg; i++) {
      const x = samples[i * 2];
      const y = samples[i * 2 + 1];
      if (has) {
        inst[nSeg * 4] = px;
        inst[nSeg * 4 + 1] = py;
        inst[nSeg * 4 + 2] = x;
        inst[nSeg * 4 + 3] = y;
        nSeg++;
      }
      px = x;
      py = y;
      has = true;
    }
    this.lastX = px;
    this.lastY = py;
    this.hasLast = has;

    const w = this.accumA.w;
    const h = this.accumA.h;

    // --- 1. Затухание послесвечения: accumA * decay -> accumB ---
    const decay = Math.pow(s.persistence, Math.max(dt, 1 / 240) * 60);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumB.fb);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.decayProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.accumA.tex);
    gl.uniform1i(gl.getUniformLocation(this.decayProg, "uTex"), 0);
    gl.uniform1f(gl.getUniformLocation(this.decayProg, "uDecay"), decay);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- 2. Аддитивный проход луча в тот же буфер ---
    if (nSeg > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.beamProg);
      gl.uniform2f(gl.getUniformLocation(this.beamProg, "uResolution"), w, h);
      const sigmaPx = s.beamWidth * (w / 800);
      gl.uniform1f(gl.getUniformLocation(this.beamProg, "uSigmaPx"), sigmaPx);
      // Калибровка яркости: не зависит от разрешения канваса
      const intensity = s.beamIntensity * 18.0 * (w / 800);
      gl.uniform1f(gl.getUniformLocation(this.beamProg, "uIntensity"), intensity);
      gl.bindVertexArray(this.beamVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.subarray(0, nSeg * 4));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nSeg);
      gl.disable(gl.BLEND);
    }

    // Свап пинг-понга: accumB — актуальный
    const tmp = this.accumA;
    this.accumA = this.accumB;
    this.accumB = tmp;

    // --- 3. Bloom: даунсемпл + два прохода размытия ---
    const bw = this.bloomA.w;
    const bh = this.bloomA.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fb);
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(this.decayProg); // как copy-шейдер с uDecay=1
    gl.bindTexture(gl.TEXTURE_2D, this.accumA.tex);
    gl.uniform1i(gl.getUniformLocation(this.decayProg, "uTex"), 0);
    gl.uniform1f(gl.getUniformLocation(this.decayProg, "uDecay"), 1.0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(this.blurProg);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, "uTex"), 0);
    // Горизонталь: bloomA -> bloomB
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB.fb);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
    gl.uniform2f(gl.getUniformLocation(this.blurProg, "uDir"), 1 / bw, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Вертикаль: bloomB -> bloomA
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fb);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomB.tex);
    gl.uniform2f(gl.getUniformLocation(this.blurProg, "uDir"), 0, 1 / bh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- 4. Композит на экран ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.compositeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.accumA.tex);
    gl.uniform1i(gl.getUniformLocation(this.compositeProg, "uAccum"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA.tex);
    gl.uniform1i(gl.getUniformLocation(this.compositeProg, "uBloom"), 1);
    const [r, g2, b] = hexToRgb(s.phosphorColor);
    gl.uniform3f(gl.getUniformLocation(this.compositeProg, "uColor"), r, g2, b);
    gl.uniform1f(gl.getUniformLocation(this.compositeProg, "uGridOn"), s.grid ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
