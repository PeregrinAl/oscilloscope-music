// Числовое поле с локальным текстовым состоянием: позволяет спокойно набирать
// «0.5», «-1», «1e-3» (жёстко контролируемый input сбрасывал точку на каждом
// нажатии). Коммитит значение на каждый валидный парс, при потере фокуса
// возвращает актуальное значение из стора.

import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  onCommit: (n: number) => void;
  /** Валидация перед коммитом (например, n > 0 для периода) */
  accept?: (n: number) => boolean;
  style?: React.CSSProperties;
  title?: string;
}

export function NumField({ value, onCommit, accept, style, title }: Props) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const tryCommit = (s: string) => {
    const n = parseFloat(s.replace(",", "."));
    if (isFinite(n) && (!accept || accept(n))) onCommit(n);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className="mini-input"
      style={style}
      title={title}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setText(e.target.value);
        tryCommit(e.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        setText(String(value));
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
