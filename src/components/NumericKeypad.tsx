import { ActionButton } from './ActionButton';

export function NumericKeypad({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const press = (key: string) => {
    if (key === '←') return onChange(value.slice(0, -1));
    if (key === 'C') return onChange('');
    if (key === '.' && value.includes('.')) return;
    onChange(`${value}${key}`);
  };
  return <div className="grid grid-cols-3 gap-2">{['7','8','9','4','5','6','1','2','3','C','0','.','←'].map((key) => <ActionButton key={key} variant="secondary" onClick={() => press(key)}>{key}</ActionButton>)}</div>;
}
