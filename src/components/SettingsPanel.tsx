import {
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
import { GlassIsland } from "./glass/GlassIsland";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface SettingsPanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  open: boolean;
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  onClose?: () => void;
}

/** A shortcut-driven settings workspace that owns focus while it is open. */
export function SettingsPanel({
  open,
  title = "Ambient Glass",
  subtitle = "Display settings",
  children,
  onClose,
  onKeyDown,
  className = "",
  ...props
}: SettingsPanelProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const headingId = useId();

  useEffect(() => {
    if (open) return;

    const rememberFocusedElement = () => {
      if (
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
      ) {
        returnFocusRef.current = document.activeElement;
      }
    };

    rememberFocusedElement();
    document.addEventListener("focusin", rememberFocusedElement);
    return () => document.removeEventListener("focusin", rememberFocusedElement);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() =>
      closeRef.current?.focus({ preventScroll: true }),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      const returnTarget = returnFocusRef.current;
      if (returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true });
      }
    };
  }, [open]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (event.key === "Escape" && onClose) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    ).filter(
      (element) =>
        element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0,
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;
  return (
    <section
      {...props}
      ref={dialogRef}
      className={`settings-surface ${className}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <GlassIsland className="settings-surface__panel" glow="bright" radius="32px">
        <header className="settings-surface__header">
          <div>
            <p>{title}</p>
            <h2 id={headingId}>{subtitle}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button settings-surface__close"
            onClick={onClose}
            aria-label="Close settings"
          >
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className="settings-surface__body">{children ?? <DefaultSettingsContent />}</div>
      </GlassIsland>
    </section>
  );
}

function DefaultSettingsContent() {
  return (
    <div className="settings-surface__default-content">
      <SettingRow
        label="Presence detection"
        description="Uses the camera locally only."
        action={<span className="settings-status is-ready">Ready</span>}
      />
      <SettingRow
        label="Wallpaper scene"
        description="Automatic · Clear Night"
        action={
          <button className="glass-action glass-action--quiet" type="button">
            Test scene
          </button>
        }
      />
      <SettingRow
        label="Connected services"
        description="Calendar, GitHub, sports"
        action={
          <button className="glass-action glass-action--quiet" type="button">
            Manage
          </button>
        }
      />
    </div>
  );
}

export interface SettingRowProps {
  label: string;
  description?: string;
  action?: ReactNode;
}

export function SettingRow({ label, description, action }: SettingRowProps) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </div>
      {action}
    </div>
  );
}
