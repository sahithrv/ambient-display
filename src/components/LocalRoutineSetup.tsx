import { useState } from "react";

export interface NewLocalTask {
  title: string;
  preferredTime?: string;
  daysOfWeek: number[];
}

export interface NewLocalReminder {
  title: string;
  localTime: string;
  daysOfWeek: number[];
}

export interface NewLocalAlarm {
  label: string;
  localTime: string;
  daysOfWeek: number[];
}

export interface LocalRoutineSetupProps {
  onAddTask: (task: NewLocalTask) => void;
  onAddReminder: (reminder: NewLocalReminder) => void;
  onAddAlarm: (alarm: NewLocalAlarm) => void;
}

const WEEKDAYS = [
  { value: 0, short: "S", label: "Sunday" },
  { value: 1, short: "M", label: "Monday" },
  { value: 2, short: "T", label: "Tuesday" },
  { value: 3, short: "W", label: "Wednesday" },
  { value: 4, short: "T", label: "Thursday" },
  { value: 5, short: "F", label: "Friday" },
  { value: 6, short: "S", label: "Saturday" },
] as const;

/**
 * Compact local-first creation controls. Weekday selection is deliberately
 * opt-in: no selected days means the routine repeats every day.
 */
export function LocalRoutineSetup({
  onAddTask,
  onAddReminder,
  onAddAlarm,
}: LocalRoutineSetupProps) {
  return (
    <section className="local-routines" aria-labelledby="local-routines-title">
      <div className="local-routines__header">
        <p className="app-settings__eyebrow" id="local-routines-title">
          Local routines
        </p>
        <span>Leave weekdays clear to repeat daily.</span>
      </div>
      <TaskSetupForm onAdd={onAddTask} />
      <ReminderSetupForm onAdd={onAddReminder} />
      <AlarmSetupForm onAdd={onAddAlarm} />
    </section>
  );
}

function TaskSetupForm({ onAdd }: { onAdd: (task: NewLocalTask) => void }) {
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [message, setMessage] = useState("");

  return (
    <form
      aria-label="Add a local task"
      className="routine-setup-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const title = String(values.get("title") ?? "").trim();
        const preferredTime = String(values.get("preferredTime") ?? "");
        if (!title) {
          setMessage("Give the task a name first.");
          return;
        }
        if (preferredTime && !isLocalTime(preferredTime)) {
          setMessage("Choose a valid local time or leave it clear.");
          return;
        }
        onAdd({ title, preferredTime: preferredTime || undefined, daysOfWeek });
        form.reset();
        setDaysOfWeek([]);
        setMessage("");
      }}
    >
      <div className="routine-setup-form__title">
        <strong>Task</strong>
        <span>Local focus list</span>
      </div>
      <label className="routine-setup-form__field">
        <span className="sr-only">Task name</span>
        <input name="title" required placeholder="Read for 20 minutes" />
      </label>
      <label className="routine-setup-form__time">
        <span>Time</span>
        <input name="preferredTime" type="time" aria-label="Preferred task time" />
      </label>
      <WeekdayPicker controlId="task-weekdays" selectedDays={daysOfWeek} onChange={setDaysOfWeek} />
      <button className="glass-action glass-action--quiet" type="submit">
        Add task
      </button>
      {message ? (
        <small className="routine-setup-form__message" role="status">
          {message}
        </small>
      ) : null}
    </form>
  );
}

function ReminderSetupForm({ onAdd }: { onAdd: (reminder: NewLocalReminder) => void }) {
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [message, setMessage] = useState("");

  return (
    <form
      aria-label="Add a local reminder"
      className="routine-setup-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const title = String(values.get("title") ?? "").trim();
        const localTime = String(values.get("time") ?? "");
        if (!title || !isLocalTime(localTime)) {
          setMessage("Give the reminder a name and a valid local time.");
          return;
        }
        onAdd({ title, localTime, daysOfWeek });
        form.reset();
        setDaysOfWeek([]);
        setMessage("");
      }}
    >
      <div className="routine-setup-form__title">
        <strong>Reminder</strong>
        <span>10-minute local notification</span>
      </div>
      <label className="routine-setup-form__field">
        <span className="sr-only">Reminder name</span>
        <input name="title" required placeholder="Stand and stretch" />
      </label>
      <label className="routine-setup-form__time">
        <span>Time</span>
        <input name="time" required type="time" defaultValue="09:00" aria-label="Reminder time" />
      </label>
      <WeekdayPicker
        controlId="reminder-weekdays"
        selectedDays={daysOfWeek}
        onChange={setDaysOfWeek}
      />
      <button className="glass-action glass-action--quiet" type="submit">
        Add reminder
      </button>
      {message ? (
        <small className="routine-setup-form__message" role="status">
          {message}
        </small>
      ) : null}
    </form>
  );
}

function AlarmSetupForm({ onAdd }: { onAdd: (alarm: NewLocalAlarm) => void }) {
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [message, setMessage] = useState("");

  return (
    <form
      aria-label="Add a local alarm"
      className="routine-setup-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const label = String(values.get("label") ?? "").trim();
        const localTime = String(values.get("time") ?? "");
        if (!label || !isLocalTime(localTime)) {
          setMessage("Give the alarm a name and a valid local time.");
          return;
        }
        onAdd({ label, localTime, daysOfWeek });
        form.reset();
        setDaysOfWeek([]);
        setMessage("");
      }}
    >
      <div className="routine-setup-form__title">
        <strong>Alarm</strong>
        <span>Ambient chime while awake</span>
      </div>
      <label className="routine-setup-form__field">
        <span className="sr-only">Alarm name</span>
        <input name="label" required placeholder="Morning run" />
      </label>
      <label className="routine-setup-form__time">
        <span>Time</span>
        <input name="time" required type="time" defaultValue="06:30" aria-label="Alarm time" />
      </label>
      <WeekdayPicker
        controlId="alarm-weekdays"
        selectedDays={daysOfWeek}
        onChange={setDaysOfWeek}
      />
      <button className="glass-action glass-action--quiet" type="submit">
        Add alarm
      </button>
      {message ? (
        <small className="routine-setup-form__message" role="status">
          {message}
        </small>
      ) : null}
    </form>
  );
}

function WeekdayPicker({
  controlId,
  selectedDays,
  onChange,
}: {
  controlId: string;
  selectedDays: number[];
  onChange: (days: number[]) => void;
}) {
  const selectionLabel =
    selectedDays.length === 0 ? "Every day" : `${selectedDays.length} weekday selection(s)`;

  return (
    <fieldset className="weekday-picker">
      <legend>
        <span>Repeat</span>
        <small id={`${controlId}-summary`}>{selectionLabel}</small>
      </legend>
      <div aria-describedby={`${controlId}-summary`} className="weekday-picker__days">
        {WEEKDAYS.map((day) => {
          const selected = selectedDays.includes(day.value);
          return (
            <button
              aria-label={`Repeat on ${day.label}`}
              aria-pressed={selected}
              className={selected ? "is-selected" : ""}
              key={day.value}
              onClick={() =>
                onChange(
                  selected
                    ? selectedDays.filter((value) => value !== day.value)
                    : [...selectedDays, day.value].sort((left, right) => left - right),
                )
              }
              type="button"
            >
              {day.short}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function isLocalTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
