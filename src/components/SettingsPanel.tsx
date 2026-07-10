import type { HTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import { GlassIsland } from "./glass/GlassIsland";

export interface SettingsPanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  open: boolean;
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  onClose?: () => void;
}

/** A deliberately compact configuration surface, reserved for shortcut-driven use. */
export function SettingsPanel({
  open,
  title = "Ambient Glass",
  subtitle = "Display settings",
  children,
  onClose,
  className = "",
  ...props
}: SettingsPanelProps) {
  if (!open) return null;
  return (
    <section
      {...props}
      className={`settings-surface ${className}`}
      role="dialog"
      aria-modal="true"
      aria-label={subtitle}
    >
      <GlassIsland className="settings-surface__panel" glow="bright" radius="32px">
        <header className="settings-surface__header">
          <div>
            <p>{title}</p>
            <h2>{subtitle}</h2>
          </div>
          <button
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
