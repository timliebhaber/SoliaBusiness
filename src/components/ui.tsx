import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";
import { IconAlert, IconCheck, IconInfo, IconX } from "./icons";

type Variant = "default" | "primary" | "danger" | "ghost" | "running";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "lg";
  block?: boolean;
  busy?: boolean;
}

export function Button({
  variant = "default",
  size = "sm",
  block,
  busy,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    variant !== "default" ? `btn-${variant}` : "",
    size === "lg" ? "btn-lg" : "",
    block ? "btn-block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={classes} disabled={disabled || busy} {...rest}>
      {busy ? <span className="spin" /> : null}
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select ${props.className ?? ""}`} />;
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "success" | "warn" | "danger" | "running";
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "danger" | "success";
  children: ReactNode;
}) {
  const Glyph = tone === "success" ? IconCheck : tone === "info" ? IconInfo : IconAlert;
  return (
    <div className={`notice notice-${tone}`}>
      <Glyph />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <div className="title">{title}</div>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

/**
 * Modaler Dialog. Escape schließt, der Fokus landet beim Öffnen im Inhalt und
 * kehrt beim Schließen zum auslösenden Element zurück.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  closable = true,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  closable?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const focusable = bodyRef.current?.querySelector<HTMLElement>(
      "input, textarea, select, button",
    );
    focusable?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && closable) {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onClose, closable]);

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (closable && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog ${wide ? "dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-head">
          <div className="row">
            <h2>{title}</h2>
            {closable ? (
              <button className="btn btn-ghost btn-icon" style={{ marginLeft: "auto" }} onClick={onClose}>
                <IconX />
              </button>
            ) : null}
          </div>
          {subtitle ? <div className="sub">{subtitle}</div> : null}
        </div>
        <div className="dialog-body" ref={bodyRef}>
          {children}
        </div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Bestätigen",
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <div className="spacer" />
          <Button onClick={onCancel}>Abbrechen</Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            busy={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>{message}</div>
    </Modal>
  );
}
