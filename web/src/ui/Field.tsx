import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

/** Props a Field passes to its control so the label, hint, and error are wired up. */
export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  required?: boolean;
}

/** Ids for a field's hint and error, and the `aria-describedby` value combining them. */
export function fieldAria(id: string, hint: unknown, error: unknown): Omit<FieldControlProps, "id" | "required"> {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return {
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error ? true : undefined,
  };
}

export interface FieldProps {
  label: ReactNode;
  /** Help text under the label. */
  hint?: ReactNode;
  /** Inline error; sets `aria-invalid` on the control and is announced (`role="alert"`). */
  error?: ReactNode;
  /** Control id; generated when omitted. */
  id?: string;
  required?: boolean;
  className?: string;
  /** Render function receiving the props to spread on the native control. */
  children: (control: FieldControlProps) => ReactNode;
}

/** Label + hint + error wrapper around any native control. */
export function Field({ label, hint, error, id, required, className, children }: FieldProps) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <div className={cx("field", className)}>
      <label className="field__label" htmlFor={controlId}>
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {hint && (
        <span id={`${controlId}-hint`} className="field__hint">
          {hint}
        </span>
      )}
      {children({ id: controlId, required, ...fieldAria(controlId, hint, error) })}
      {error && (
        <span id={`${controlId}-error`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

interface LabelledProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Class for the wrapper (the control gets `className`). */
  fieldClassName?: string;
}

export type TextInputProps = LabelledProps & InputHTMLAttributes<HTMLInputElement>;

/** Labelled `<input>` (text, number, date, email, …). */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, fieldClassName, id, required, className, type = "text", ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} id={id} required={required} className={fieldClassName}>
      {(control) => <input ref={ref} type={type} className={cx("field__control", className)} {...control} {...rest} />}
    </Field>
  );
});

export type TextAreaProps = LabelledProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Labelled `<textarea>`. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, fieldClassName, id, required, className, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} id={id} required={required} className={fieldClassName}>
      {(control) => <textarea ref={ref} className={cx("field__control", className)} {...control} {...rest} />}
    </Field>
  );
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectProps = LabelledProps &
  SelectHTMLAttributes<HTMLSelectElement> & {
    /** Options to render; alternatively pass `<option>` children. */
    options?: readonly SelectOption[];
    /** Adds a first empty option with this text (value ""). */
    placeholder?: string;
  };

/** Labelled `<select>`. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, fieldClassName, id, required, className, options, placeholder, children, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} id={id} required={required} className={fieldClassName}>
      {(control) => (
        <select ref={ref} className={cx("field__control", className)} {...control} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options?.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
      )}
    </Field>
  );
});

export type CheckboxProps = Omit<LabelledProps, "label"> &
  Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
    label: ReactNode;
  };

/** Native checkbox with its label to the right, plus optional hint and error. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, error, fieldClassName, id, className, disabled, ...rest },
  ref,
) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <div className={cx("checkbox", disabled && "checkbox--disabled", fieldClassName)}>
      <label className="checkbox__row" htmlFor={controlId}>
        <input
          ref={ref}
          type="checkbox"
          id={controlId}
          className={className}
          disabled={disabled}
          {...fieldAria(controlId, hint, error)}
          {...rest}
        />
        <span className="checkbox__text">{label}</span>
      </label>
      {hint && (
        <span id={`${controlId}-hint`} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${controlId}-error`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
});
