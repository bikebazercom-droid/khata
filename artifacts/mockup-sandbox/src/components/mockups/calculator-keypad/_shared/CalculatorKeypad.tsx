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
  className,
}: {
  def: KeyDef;
  variant: Variant;
  className?: string;
}) {
  const isReference = variant === 'reference-matched';
  const memoryRow = ['C', 'M+', 'M-', 'DEL'].includes(def.value);
  const keyKind = isReference && def.value === 'DEL'
    ? 'muted'
    : isReference && def.value === '='
      ? 'digit'
      : def.kind;
  const referenceShadow = 'shadow-[0_2px_4px_rgba(0,0,0,0.15)]';

  return (
    <button
      type="button"
      style={{
        ...(def.span && !isReference ? { gridColumn: `span ${def.span}` } : undefined),
        transform: 'translate3d(0,0,0)',
        backfaceVisibility: 'hidden',
        willChange: 'background-color',
      }}
      className={[
        'font-bold flex items-center justify-center transition-[background-color,transform] duration-[50ms] ease-out select-none',
        isReference
          ? `h-11 text-base rounded-[5px] ${referenceShadow} active:scale-[0.98] active:brightness-95`
          : 'h-14 text-lg rounded-xl active:scale-[0.95]',
        !isReference && 'active:bg-[#4A3C31] active:text-white active:shadow-none',
        keyKind === 'digit' && `bg-white text-slate-800 ${isReference ? referenceShadow : 'shadow-sm'}`,
        keyKind === 'muted' && (isReference
          ? `bg-[#cbdced] text-[#123f86] ${referenceShadow}`
          : 'bg-blue-50 text-blue-900 shadow-sm'),
        keyKind === 'accent' && (isReference
          ? `bg-[#0d55ad] text-white ${referenceShadow}`
          : 'bg-[#0b3d91] text-white shadow-sm'),
        isReference && memoryRow && 'rounded-[5px]',
        className,
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
    ? 'pt-2 pr-2 pl-2 pb-2'
    : 'pt-3 pr-3 pl-3 pb-4';
  const compactContainer = variant === 'reference-matched'
    ? 'max-h-[min(52dvh,22rem)] overflow-y-auto'
    : '';

  return (
    <div
      className={`w-full bg-[#eef2f7] ${padding} ${rowGap} ${compactContainer} shrink-0`}
      style={{ transform: 'translate3d(0,0,0)', backfaceVisibility: 'hidden' }}
    >
      <div
        className={`grid ${gridGap}`}
        style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
      >
        {renderRow(memoryRow, variant)}
      </div>
      {variant === 'reference-matched' ? (
        <>
          <div
            className={`grid ${gridGap}`}
            style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
          >
            {renderRow(ROW_789.slice(0, 3), variant)}
            <div className={`flex min-w-0 ${gridGap}`}>
              <Key
                def={ROW_789[3]}
                variant={variant}
                className="min-w-0 flex-1"
              />
              <Key
                def={ROW_789[4]}
                variant={variant}
                className="min-w-0 flex-1"
              />
            </div>
          </div>
          {[ROW_456, ROW_123, ROW_0DOT].map((row, index) => (
            <div
              key={index}
              className={`grid ${gridGap}`}
              style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}
            >
              {renderRow(row, variant)}
            </div>
          ))}
        </>
      ) : (
        [ROW_789, ROW_456, ROW_123, ROW_0DOT].map((row, index) => (
          <div
            key={index}
            className={`grid ${gridGap}`}
            style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}
          >
            {renderRow(row, variant)}
          </div>
        ))
      )}
    </div>
  );
}
