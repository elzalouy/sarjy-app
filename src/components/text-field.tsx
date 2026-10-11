type TextFieldProps = {
  label: string;
  name: string;
  type?: "text" | "password" | "tel";
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  autoComplete?: string;
  disabled?: boolean;
  dir?: "ltr" | "rtl" | "auto";
  maxLength?: number;
};

export function TextField({
  label,
  name,
  type = "text",
  value,
  onChange,
  error,
  hint,
  autoComplete,
  disabled = false,
  dir,
  maxLength,
}: TextFieldProps) {
  const inputId = `${name}-input`;
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy = [hint ? hintId : undefined, error ? errorId : undefined]
    .filter((id) => id !== undefined)
    .join(" ");

  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="ui-input"
        name={name}
        type={type}
        value={value}
        disabled={disabled}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        dir={dir}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint ? (
        <p className="ui-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="ui-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
