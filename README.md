# XY Scope — веб-приложение для oscilloscope music

«Desmos для XY-музыки»: задаёте параметрические функции `x(t)`, `y(t)`,
крутите переменные ползунками (с анимацией) — и в реальном времени видите
фигуру на реалистичном ЭЛТ-осциллографе и слышите тот же сигнал в стерео.

**Ключевой инвариант: картинка и звук — один и тот же стерео-сигнал.**
Левый канал → X, правый → Y. Скоп рисует ровно те сэмплы, что идут в звук.

## Запуск

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production-сборка в dist/
```

## Возможности

- Редактор `x(t)` / `y(t)` с живой перекомпиляцией; ошибка формулы подсвечивается
  и не прерывает звук. Новые буквы в формуле автоматически становятся ползунками.
- Переменные: min/max/step, анимация `ramp` (loop/pingpong) и `lfo`.
- 8 встроенных пресетов (окружность, эллипс, Лиссажу, спираль, роза,
  гармонограф, многоугольник/звезда, восьмёрка).
- **Пользовательские пресеты**: сохранение своих фигур в localStorage браузера.
- Реалистичный XY-скоп (WebGL2): яркость ∝ времени пребывания луча,
  гауссов профиль, фосфорное послесвечение, bloom, зелёный фосфор P31,
  настраиваемые яркость/толщина/затухание/цвет/сетка.
- DSP-панели: осциллограммы L и R, спектр (FFT через AnalyserNode).
- Транспорт: Play/Pause/Stop, мьют (визуал продолжает работать),
  частота обхода 20–2000 Гц, громкость.
- Сохранение/шаринг: ссылка с проектом в URL, экспорт/импорт JSON.

## Синтаксис формул

`t ∈ [0, 1)` — фаза одного обхода фигуры (для угла умножайте на `tau`).
Операторы `+ - * / ^ %`; функции `sin cos tan asin acos atan atan2 sinh cosh
tanh exp log ln log10 log2 sqrt cbrt abs sign floor ceil round min max pow
mod frac clamp square saw tri`; константы `pi tau e`; `T` — глобальное время
в секундах (для собственных анимаций).

## Архитектура

| Модуль | Файлы | Роль |
|---|---|---|
| Formula Engine | `src/engine/expr.ts` | парсер → компиляция в JS-функцию (исполняется и в воркилете, и в рендере) |
| Audio Engine | `public/xy-worklet.js`, `src/audio/engine.ts` | AudioWorklet — единственный генератор сэмплов; SAB-кольцо для скопа |
| Renderer | `src/render/scope.ts` | WebGL2: erf-интеграл гауссова луча, послесвечение, bloom (модель woscope, MIT) |
| UI / State | `src/state/store.ts`, `src/ui/*` | Zustand + React |

## Живое демо

**https://peregrinal.github.io/oscilloscope-music/**

Деплой на GitHub Pages: `npm run deploy` (собирает и пушит в ветку
`gh-pages`). Pages не отдаёт COOP/COEP-заголовки, поэтому используется
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) (MIT) —
сервис-воркер включает cross-origin isolation, и SAB-путь работает;
на первом визите страница один раз автоматически перезагружается.

## Деплой: заголовки COOP/COEP

Для пути через `SharedArrayBuffer` (точная синхронизация «что видишь = что
слышишь») хостинг должен отдавать:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

В dev/preview-серверах Vite это уже настроено (`vite.config.ts`).
Без заголовков приложение автоматически переключается на fallback
(передача сэмплов через postMessage) — всё работает, бейдж в шапке
покажет «fallback» вместо «SAB».

Примеры: Netlify — `_headers`; Vercel — `vercel.json` → `headers`;
nginx — `add_header`.
