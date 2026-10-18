interface SwitchProps {
  checked: boolean;
  labelId: string;
  descId?: string;
  disabled?: boolean;
  onToggle(): void;
}

export function Switch({ checked, labelId, descId, disabled, onToggle }: SwitchProps) {
  return (
    <button
      type="button"
      class="switch"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={descId}
      disabled={disabled}
      onClick={onToggle}
    />
  );
}
