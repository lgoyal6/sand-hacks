"use client";
// 1..7 confidence rating (Rozenblit & Keil): asked before and after explaining.
export function ConfidenceScale({ name, value, onChange, legend }: { name: string; value: number | null; onChange: (v: number) => void; legend: string }) {
  return (
    <fieldset id={`${name}-scale`} className="space-y-3">
      <legend className="font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <label key={n} htmlFor={`${name}-${n}`} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-md border has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground">
            <input className="sr-only" type="radio" id={`${name}-${n}`} name={name} value={n} checked={value === n} onChange={() => onChange(n)} />
            {n}
          </label>
        ))}
      </div>
      <div className="flex max-w-[22rem] justify-between text-xs text-muted-foreground">
        <span>1 = just guessing</span>
        <span>7 = could teach it</span>
      </div>
    </fieldset>
  );
}
