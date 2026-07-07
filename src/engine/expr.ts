// Formula Engine (§5.1): парсер выражений с компиляцией в быстрый JS-код.
// Результат компиляции — строка тела функции (t, v) => number, где v — объект
// значений переменных. Строка отправляется в AudioWorklet и там превращается
// в функцию через new Function — так один и тот же код исполняется и в аудио,
// и в рендере (единый источник истины, §4.1).

export interface CompiledExpr {
  /** Тело функции: аргументы (t, v), возвращает число */
  body: string;
  /** Имена пользовательских переменных, встреченных в формуле */
  variables: string[];
  /** Готовая функция для main-thread (режим ideal, превью) */
  fn: (t: number, v: Record<string, number>) => number;
}

export class ParseError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

// --- Токенизация ---

type Token =
  | { kind: "num"; value: number; pos: number }
  | { kind: "ident"; name: string; pos: number }
  | { kind: "op"; op: string; pos: number };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new ParseError("Некорректное число", i);
      tokens.push({ kind: "num", value: parseFloat(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))!;
      tokens.push({ kind: "ident", name: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if ("+-*/^(),%".includes(c)) {
      tokens.push({ kind: "op", op: c, pos: i });
      i++;
      continue;
    }
    throw new ParseError(`Неожиданный символ «${c}»`, i);
  }
  return tokens;
}

// --- Известные функции и константы ---

// name -> [jsCode, arity] ; arity -1 = переменное число аргументов (min/max)
const FUNCS: Record<string, { js: string; arity: number }> = {
  sin: { js: "Math.sin", arity: 1 },
  cos: { js: "Math.cos", arity: 1 },
  tan: { js: "Math.tan", arity: 1 },
  asin: { js: "Math.asin", arity: 1 },
  acos: { js: "Math.acos", arity: 1 },
  atan: { js: "Math.atan", arity: 1 },
  atan2: { js: "Math.atan2", arity: 2 },
  sinh: { js: "Math.sinh", arity: 1 },
  cosh: { js: "Math.cosh", arity: 1 },
  tanh: { js: "Math.tanh", arity: 1 },
  exp: { js: "Math.exp", arity: 1 },
  log: { js: "Math.log", arity: 1 },
  ln: { js: "Math.log", arity: 1 },
  log10: { js: "Math.log10", arity: 1 },
  log2: { js: "Math.log2", arity: 1 },
  sqrt: { js: "Math.sqrt", arity: 1 },
  cbrt: { js: "Math.cbrt", arity: 1 },
  abs: { js: "Math.abs", arity: 1 },
  sign: { js: "Math.sign", arity: 1 },
  floor: { js: "Math.floor", arity: 1 },
  ceil: { js: "Math.ceil", arity: 1 },
  round: { js: "Math.round", arity: 1 },
  min: { js: "Math.min", arity: -1 },
  max: { js: "Math.max", arity: -1 },
  pow: { js: "Math.pow", arity: 2 },
  // mod — математический (результат всегда в [0, b)), не JS-остаток
  mod: { js: "__mod", arity: 2 },
  frac: { js: "__frac", arity: 1 },
  clamp: { js: "__clamp", arity: 3 },
  // Прямоугольник/пила/треугольник — удобны для фигур
  square: { js: "__square", arity: 1 },
  saw: { js: "__saw", arity: 1 },
  tri: { js: "__tri", arity: 1 },
};

const CONSTS: Record<string, string> = {
  pi: "Math.PI",
  tau: "(Math.PI*2)",
  e: "Math.E",
};

// Хелперы, добавляемые в преамбулу скомпилированной функции.
// ВАЖНО: этот же текст используется в AudioWorklet — без ссылок на DOM.
export const EXPR_PRELUDE = `
var __mod = function(a, b) { return ((a % b) + b) % b; };
var __frac = function(a) { return a - Math.floor(a); };
var __clamp = function(x, lo, hi) { return Math.min(Math.max(x, lo), hi); };
var __square = function(p) { return __frac(p) < 0.5 ? 1 : -1; };
var __saw = function(p) { return __frac(p) * 2 - 1; };
var __tri = function(p) { var q = __frac(p); return q < 0.5 ? q * 4 - 1 : 3 - q * 4; };
`;

// --- Парсер (рекурсивный спуск / Пратт) ---

interface Ctx {
  tokens: Token[];
  i: number;
  variables: Set<string>;
}

function peek(ctx: Ctx): Token | undefined {
  return ctx.tokens[ctx.i];
}

function expectOp(ctx: Ctx, op: string) {
  const t = peek(ctx);
  if (!t || t.kind !== "op" || t.op !== op) {
    throw new ParseError(`Ожидалось «${op}»`, t ? t.pos : Infinity);
  }
  ctx.i++;
}

// expr := addsub
// addsub := muldiv (('+'|'-') muldiv)*
// muldiv := unary (('*'|'/'|'%') unary)*
// unary := '-' unary | power
// power := atom ('^' unary)?          (правоассоциативно)
// atom := num | ident | ident '(' args ')' | '(' expr ')'

function parseExpr(ctx: Ctx): string {
  return parseAddSub(ctx);
}

function parseAddSub(ctx: Ctx): string {
  let left = parseMulDiv(ctx);
  for (;;) {
    const t = peek(ctx);
    if (t && t.kind === "op" && (t.op === "+" || t.op === "-")) {
      ctx.i++;
      const right = parseMulDiv(ctx);
      left = `(${left}${t.op}${right})`;
    } else return left;
  }
}

function parseMulDiv(ctx: Ctx): string {
  let left = parseUnary(ctx);
  for (;;) {
    const t = peek(ctx);
    if (t && t.kind === "op" && (t.op === "*" || t.op === "/" || t.op === "%")) {
      ctx.i++;
      const right = parseUnary(ctx);
      left = t.op === "%" ? `__mod(${left},${right})` : `(${left}${t.op}${right})`;
    } else return left;
  }
}

function parseUnary(ctx: Ctx): string {
  const t = peek(ctx);
  if (t && t.kind === "op" && t.op === "-") {
    ctx.i++;
    return `(-${parseUnary(ctx)})`;
  }
  if (t && t.kind === "op" && t.op === "+") {
    ctx.i++;
    return parseUnary(ctx);
  }
  return parsePower(ctx);
}

function parsePower(ctx: Ctx): string {
  const base = parseAtom(ctx);
  const t = peek(ctx);
  if (t && t.kind === "op" && t.op === "^") {
    ctx.i++;
    const exp = parseUnary(ctx); // правоассоциативность: a^b^c = a^(b^c)
    return `Math.pow(${base},${exp})`;
  }
  return base;
}

const RESERVED = new Set(["t", "T"]);

function parseAtom(ctx: Ctx): string {
  const t = peek(ctx);
  if (!t) throw new ParseError("Неожиданный конец формулы", Infinity);

  if (t.kind === "num") {
    ctx.i++;
    return String(t.value);
  }

  if (t.kind === "op" && t.op === "(") {
    ctx.i++;
    const inner = parseExpr(ctx);
    expectOp(ctx, ")");
    return `(${inner})`;
  }

  if (t.kind === "ident") {
    ctx.i++;
    const next = peek(ctx);
    // Вызов функции
    if (next && next.kind === "op" && next.op === "(") {
      const fn = FUNCS[t.name];
      if (!fn) throw new ParseError(`Неизвестная функция «${t.name}»`, t.pos);
      ctx.i++;
      const args: string[] = [];
      if (!(peek(ctx)?.kind === "op" && (peek(ctx) as any).op === ")")) {
        args.push(parseExpr(ctx));
        while (peek(ctx)?.kind === "op" && (peek(ctx) as any).op === ",") {
          ctx.i++;
          args.push(parseExpr(ctx));
        }
      }
      expectOp(ctx, ")");
      if (fn.arity >= 0 && args.length !== fn.arity) {
        throw new ParseError(
          `«${t.name}» ожидает ${fn.arity} аргумент(а), получено ${args.length}`,
          t.pos
        );
      }
      if (fn.arity === -1 && args.length < 2) {
        throw new ParseError(`«${t.name}» ожидает минимум 2 аргумента`, t.pos);
      }
      return `${fn.js}(${args.join(",")})`;
    }
    // Константа
    if (CONSTS[t.name]) return CONSTS[t.name];
    // Фаза t / глобальное время T
    if (t.name === "t") return "t";
    if (t.name === "T") return "(v.T||0)";
    // Пользовательская переменная
    if (FUNCS[t.name]) {
      throw new ParseError(`«${t.name}» — функция, нужны скобки: ${t.name}(...)`, t.pos);
    }
    ctx.variables.add(t.name);
    return `(v.${t.name}||0)`;
  }

  throw new ParseError(`Неожиданный токен «${(t as any).op ?? ""}»`, t.pos);
}

/**
 * Компилирует формулу. Бросает ParseError при синтаксической ошибке.
 */
export function compileExpr(src: string): CompiledExpr {
  if (!src.trim()) throw new ParseError("Пустая формула", 0);
  const ctx: Ctx = { tokens: tokenize(src), i: 0, variables: new Set() };
  const expr = parseExpr(ctx);
  if (ctx.i < ctx.tokens.length) {
    throw new ParseError("Лишние символы в конце формулы", ctx.tokens[ctx.i].pos);
  }
  const body = `${EXPR_PRELUDE}\nreturn (${expr});`;
  // Проверочная компиляция — ловим то, что мог пропустить парсер
  const fn = new Function("t", "v", body) as CompiledExpr["fn"];
  // Пробный вызов: не должен кидать исключения
  fn(0, {});
  return { body, variables: [...ctx.variables], fn };
}

/** Имена, которые нельзя использовать как имя переменной-слайдера */
export function isReservedName(name: string): boolean {
  return RESERVED.has(name) || !!FUNCS[name] || !!CONSTS[name];
}
