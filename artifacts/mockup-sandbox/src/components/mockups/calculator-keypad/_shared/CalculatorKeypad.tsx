type KeyKind = 'digit' | 'muted' | 'accent';
type KeyDef = { label: string; value: string; kind: KeyKind; span?: number };
type Variant = 'current' | 'reference-matched';

const ROW_789: KeyDef[] = [
  { label: '7', value: '7', kind: 'digit' },
  { label: '8', value: '8', kind: 'digit' },
  { label: '9', value: '9', kind: 'digit' },
  { label: '÷', value: '/', kind: 'muted' },
  { label: '%', value: '%', kind: 'muted' },
];
const ROW_456: KeyDef[] = [
  { label: '4', value: '4', kind: 'digit' },
  { label: '5', value: '5', kind: 'digit' },
  { label: '6', value: '6', kind: 'digit' },
  { label: '×', value: '*', kind: 'muted', span: 2 },
];
const ROW_123: KeyDef[] = [
  { label: '1', value: '1', kind: 'digit' },
  { label: '2', value: '2', kind: 'digit' },
  { label: '3', value: '3', kind: 'digit' },
  { label: '−', value: '-', kind: 'accent', span: 2 },
];
const ROW_0DOT: KeyDef[] = [
  { label: '0', value: '0', kind: 'digit' },
  { label: '.', value: '.', kind: 'digit' },
  { label: '=', value: '=', kind: 'muted' },
  { label: '+', value: '+', kind: 'accent', span: 2 },
];

function Key({
  def,
  variant,
}: {
  def: KeyDef;
  variant: Variant;
}) {
  const isReference = variant === 'reference-matched';
  const memoryRow = ['C', 'M+', 'M-', 'DEL'].includes(def.value);
  const keyKind = isReference && def.value === 'DEL' ? 'muted' : def.kind;

  return (
    <button
      type="button"
      style={{
        ...(def.span ? { gridColumn: `span ${def.span}` } : undefined),
        transform: 'translate3d(0,0,0)',
        backfaceVisibility: 'hidden',
        willChange: 'background-color',
      }}
      className={[
        'h-14 font-bold text-lg flex items-center justify-center transition-[background-color,transform] duration-[50ms] ease-out select-none',
        isReference ? 'rounded-lg active:scale-[0.98] active:brightness-95' : 'rounded-xl active:scale-[0.95]',
        !isReference && 'active:bg-[#4A3C31] active:text-white active:shadow-none',
        keyKind === 'digit' && 'bg-white text-slate-800 shadow-sm',
        keyKind === 'muted' && (isReference
          ? 'bg-[#e6eef8] text-[#123f86] shadow-sm'
          : 'bg-blue-50 text-blue-900 shadow-sm'),
        keyKind === 'accent' && (isReference
          ? 'bg-[#0b3d91] text-white shadow-sm active:bg-blue-950'
          : 'bg-[#0b3d91] text-white shadow-sm'),
        isReference && memoryRow && 'rounded-lg',
      ].filter(Boolean).join(' ')}
    >
      {def.label}
    </button>
  );
}

function renderRow(defs: KeyDef[], variant: Variant) {
  return defs.map((def) => (
    <Key key={def.value} def={def} variant={variant} />
  ));
}

export function CalculatorKeypad({ variant }: { variant: Variant }) {
  const memoryRow: KeyDef[] = [
    { label: 'C', value: 'C', kind: 'muted' },
    { label: 'M+', value: 'M+', kind: 'muted' },
    { label: 'M-', value: 'M-', kind: 'muted' },
    { label: '⌫', value: 'DEL', kind: 'digit' },
  ];
  const rowGap = variant === 'reference-matched' ? 'space-y-1.5' : 'space-y-2';
  const gridGap = variant === 'reference-matched' ? 'gap-1.5' : 'gap-2';
  const padding = variant === 'reference-matched'
    ? 'pt-2.5 pr-2.5 pl-2.5 pb-4'
    : 'pt-3 pr-3 pl-3 pb-4';

  return (
    <div
      className={`w-full bg-[#eef2f7] ${padding} ${rowGap} shrink-0`}
      style={{ transform: 'translate3d(0,0,0)', backfaceVisibility: 'hidden' }}
    >
      <div className={`grid grid-cols-4 ${gridGap}`}>
        {renderRow(memoryRow, variant)}
      </div>
      {[ROW_789, ROW_456, ROW_123, ROW_0DOT].map((row, index) => (
        <div key={index} className={`grid grid-cols-5 ${gridGap}`}>
          {renderRow(row, variant)}
        </div>
      ))}
    </div>
  );
}
