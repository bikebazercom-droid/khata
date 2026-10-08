import './_group.css';
import { CalculatorKeypad } from './_shared/CalculatorKeypad';

export function Current() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#eef2f7] p-3">
      <div className="w-full max-w-[600px]">
        <CalculatorKeypad variant="current" />
      </div>
    </main>
  );
}
