import { useState } from 'react';

type Operator = '+' | '−' | '×' | '÷';
type KeyTone = 'number' | 'function' | 'operator' | 'equals';

type KeySpec = {
  label: string;
  value: string;
  tone: KeyTone;
  ariaLabel?: string;
};

const memoryKeys: KeySpec[] = [
  { label: 'C', value: 'C', tone: 'function', ariaLabel: 'Clear' },
  { label: 'M+', value: 'M+', tone: 'function', ariaLabel: 'Add display to memory' },
  { label: 'M−', value: 'M-', tone: 'function', ariaLabel: 'Subtract display from memory' },
  { label: '⌫', value: 'DEL', tone: 'function', ariaLabel: 'Delete last digit' },
];

const topKeys: KeySpec[] = [
  { label: '7', value: '7', tone: 'number' },
  { label: '8', value: '8', tone: 'number' },
  { label: '9', value: '9', tone: 'number' },
];

const rows: KeySpec[][] = [
  [
    { label: '4', value: '4', tone: 'number' },
    { label: '5', value: '5', tone: 'number' },
    { label: '6', value: '6', tone: 'number' },
    { label: '×', value: '*', tone: 'operator' },
  ],
  [
    { label: '1', value: '1', tone: 'number' },
    { label: '2', value: '2', tone: 'number' },
    { label: '3', value: '3', tone: 'number' },
    { label: '−', value: '-', tone: 'operator' },
  ],
  [
    { label: '0', value: '0', tone: 'number' },
    { label: '.', value: '.', tone: 'number' },
    { label: '=', value: '=', tone: 'equals' },
    { label: '+', value: '+', tone: 'operator' },
  ],
];

const operationSymbol = (value: Operator) => value;

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return 'Error';
  const rounded = Number.parseFloat(value.toPrecision(11));
  return String(rounded);
}

export function AfterHours() {
  const [display, setDisplay] = useState('0');
  const [expression, setExpression] = useState('');
  const [operator, setOperator] = useState<Operator | null>(null);
  const [storedValue, setStoredValue] = useState<number | null>(null);
  const [replaceDisplay, setReplaceDisplay] = useState(true);
  const [memory, setMemory] = useState(0);

  const runOperation = (left: number, right: number, op: Operator) => {
    if (op === '+') return left + right;
    if (op === '−') return left - right;
    if (op === '×') return left * right;
    return right === 0 ? Number.NaN : left / right;
  };

  const press = (value: string) => {
    if (/^\d$/.test(value)) {
      setDisplay((current) => {
        if (replaceDisplay || current === 'Error') return value;
        return current.length < 12 ? `${current}${value}` : current;
      });
      setReplaceDisplay(false);
      return;
    }

    if (value === '.') {
      setDisplay((current) => {
        if (replaceDisplay || current === 'Error') return '0.';
        return current.includes('.') ? current : `${current}.`;
      });
      setReplaceDisplay(false);
      return;
    }

    if (value === 'C') {
      setDisplay('0');
      setExpression('');
      setOperator(null);
      setStoredValue(null);
      setReplaceDisplay(true);
      return;
    }

    if (value === 'DEL') {
      setDisplay((current) => {
        if (replaceDisplay || current === 'Error') return '0';
        const next = current.slice(0, -1);
        return next === '' || next === '-' ? '0' : next;
      });
      setReplaceDisplay(false);
      return;
    }

    if (value === '%') {
      const next = formatNumber(Number(display) / 100);
      setDisplay(next);
      setReplaceDisplay(true);
      return;
    }

    if (value === 'M+' || value === 'M-') {
      const amount = Number(display);
      setMemory((current) => current + (value === 'M+' ? amount : -amount));
      return;
    }

    if (value === '=') {
      if (operator && storedValue !== null) {
        const result = formatNumber(runOperation(storedValue, Number(display), operator));
        setExpression(`${formatNumber(storedValue)} ${operationSymbol(operator)} ${display} =`);
        setDisplay(result);
        setOperator(null);
        setStoredValue(null);
        setReplaceDisplay(true);
      }
      return;
    }

    const nextOperator = value === '*' ? '×' : value === '/' ? '÷' : value === '-' ? '−' : value as Operator;
    const currentValue = Number(display);
    if (operator && storedValue !== null && !replaceDisplay) {
      const result = runOperation(storedValue, currentValue, operator);
      setStoredValue(result);
      setDisplay(formatNumber(result));
      setExpression(`${formatNumber(result)} ${operationSymbol(nextOperator)}`);
    } else {
      setStoredValue(currentValue);
      setExpression(`${display} ${operationSymbol(nextOperator)}`);
    }
    setOperator(nextOperator);
    setReplaceDisplay(true);
  };

  const keyClass = (tone: KeyTone) => {
    const base = 'flex h-14 min-h-[56px] w-full select-none items-center justify-center rounded-[5px] border text-[19px] font-semibold transition-[transform,background-color,border-color,color] duration-100 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7ff50] focus-visible:ring-offset-2 focus-visible:ring-offset-[#17201e]';
    if (tone === 'number') {
      return `${base} border-[#34403b] bg-[#e7ece5] text-[#17201e] shadow-[0_2px_0_#aab5a9] hover:bg-white`;
    }
    if (tone === 'function') {
      return `${base} border-[#3b4943] bg-[#2b3631] text-[#e6eee8] shadow-[0_2px_0_#202824] hover:bg-[#34413b]`;
    }
    if (tone === 'equals') {
      return `${base} border-[#d7ff50] bg-[#d7ff50] text-[#19211b] shadow-[0_2px_0_#9dbd36] hover:bg-[#e2ff83]`;
    }
    return `${base} border-[#829a3f] bg-[#45552c] text-[#f0ffc7] shadow-[0_2px_0_#303c20] hover:bg-[#526535]`;
  };

  const renderKey = (key: KeySpec, layoutClassName = '') => (
    <button
      key={key.value}
      type="button"
      aria-label={key.ariaLabel ?? key.label}
      onClick={() => press(key.value)}
      className={`${keyClass(key.tone)} ${layoutClassName}`}
    >
      {key.label}
    </button>
  );

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#111816] px-4 py-8 text-[#edf2eb]">
      <section
        aria-label="After Hours calculator"
        className="w-full max-w-[440px] overflow-hidden rounded-[23px] border border-[#36413b] bg-[#202925] p-3 shadow-[0_24px_64px_rgba(0,0,0,0.42)]"
      >
        <header className="flex items-center justify-between px-2 pb-3 pt-1">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-[#d7ff50] shadow-[0_0_0_4px_rgba(215,255,80,0.12)]" />
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#c2ccc4]">After Hours</span>
          </div>
          <span className="font-mono text-[10px] tracking-[0.16em] text-[#849188]">CALC / 01</span>
        </header>

        <div className="mb-3 rounded-[15px] border border-[#3a4740] bg-[#151d19] px-4 pb-3 pt-3 shadow-[inset_0_2px_10px_rgba(0,0,0,0.24)]">
          <div className="flex min-h-4 items-center justify-between gap-3">
            <p aria-live="polite" className="truncate font-mono text-[11px] tracking-wide text-[#9aa99e]">
              {expression || '\u00a0'}
            </p>
            {memory !== 0 && (
              <span className="shrink-0 rounded bg-[#d7ff50] px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-[#19211b]">
                MEM
              </span>
            )}
          </div>
          <output aria-label="Calculator display" className="mt-1 block overflow-hidden text-right font-mono text-[38px] font-medium leading-[1.12] tracking-[-0.07em] text-[#f3f7ef]">
            {display}
          </output>
        </div>

        <div className="space-y-1.5">
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
          >
            {memoryKeys.map((key) => renderKey(key))}
          </div>

          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
          >
            {topKeys.map((key) => renderKey(key))}
            <div className="flex min-w-0 gap-1.5">
              {renderKey(
                { label: '÷', value: '/', tone: 'operator' },
                'min-w-0 flex-1',
              )}
              {renderKey(
                { label: '%', value: '%', tone: 'function' },
                'min-w-0 flex-1',
              )}
            </div>
          </div>

          {rows.map((row, index) => (
            <div
              key={index}
              className="grid gap-1.5"
              style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
            >
              {row.map((key) => renderKey(key))}
            </div>
          ))}
        </div>
        <footer className="flex items-center justify-between px-1 pb-0.5 pt-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#75837a]">Precision at a glance</span>
          <span className="h-1 w-8 rounded-full bg-[#48564c]" aria-hidden="true" />
        </footer>
      </section>
    </main>
  );
}
