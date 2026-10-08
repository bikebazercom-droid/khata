import './_group.css';
import { CalculatorKeypad } from './_shared/CalculatorKeypad';

export function ReferenceMatched() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#eef2f7] p-3">
      <div className="w-full max-w-[600px]">
        <CalculatorKeypad variant="reference-matched" />
      </div>
    </main>
  );
}
