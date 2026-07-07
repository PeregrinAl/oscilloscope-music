// Редактор функций x(t), y(t) (§3.1). Ошибки парсинга подсвечиваются,
// не прерывая звук — в воркилете остаётся последняя рабочая версия.

import { useStore } from "../state/store";

function FormulaInput({ axis }: { axis: "x" | "y" }) {
  const src = useStore((s) => s.project.functions[axis]);
  const error = useStore((s) => s.errors[axis]);
  const setFunction = useStore((s) => s.setFunction);
  return (
    <div className="formula-row">
      <label>{axis}(t) =</label>
      <input
        className={error ? "error" : ""}
        value={src}
        spellCheck={false}
        onChange={(e) => setFunction(axis, e.target.value)}
      />
      <div className="formula-error">{error ?? ""}</div>
    </div>
  );
}

export function FunctionEditor() {
  return (
    <div className="panel">
      <h2>Функции</h2>
      <FormulaInput axis="x" />
      <FormulaInput axis="y" />
      <div className="formula-hint">
        t ∈ [0, 1) — фаза одного обхода фигуры (умножайте на tau для угла).
        Доступно: + − * / ^ %, sin cos tan asin acos atan atan2 exp log sqrt abs
        floor ceil round sign min max mod frac clamp square saw tri, константы pi
        tau e, глобальное время T. Новые буквы в формуле автоматически становятся
        ползунками.
      </div>
    </div>
  );
}
