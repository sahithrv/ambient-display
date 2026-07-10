import { useState } from "react";
import type { CalendarEvent } from "../domain";
import {
  beginGoogleCalendarOAuth,
  completeGoogleCalendarOAuth,
  createGoogleCalendarEvent,
  disconnectGoogleCalendar,
} from "../services/nativeRuntime";
import { isTauriRuntime } from "../services/tauri";

export interface GoogleCalendarSetupProps {
  connected: boolean;
  onConnectionChanged: () => void;
  onEventCreated: (event: CalendarEvent) => void;
}

/**
 * Deliberately keeps OAuth and event creation out of the main display. The
 * native command launches the authorization URL in the system browser; this
 * webview never receives an authorization code, verifier, access token, or
 * refresh token.
 */
export function GoogleCalendarSetup({
  connected,
  onConnectionChanged,
  onEventCreated,
}: GoogleCalendarSetupProps) {
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    connected
      ? "Google Calendar is connected through native secure storage."
      : "Local calendar remains available until you connect Google.",
  );

  const beginConnection = () => {
    setBusy(true);
    void beginGoogleCalendarOAuth()
      .then((result) => {
        setPending(result.pending);
        setMessage(result.message);
        if (result.connected) {
          onConnectionChanged();
        }
      })
      .finally(() => setBusy(false));
  };

  const completeConnection = () => {
    setBusy(true);
    void completeGoogleCalendarOAuth()
      .then((result) => {
        setPending(result.pending);
        setMessage(result.message);
        if (result.connected) {
          onConnectionChanged();
        }
      })
      .finally(() => setBusy(false));
  };

  const disconnect = () => {
    setBusy(true);
    void disconnectGoogleCalendar()
      .then((result) => {
        setPending(false);
        setMessage(result.message);
        onConnectionChanged();
      })
      .finally(() => setBusy(false));
  };

  if (!isTauriRuntime()) {
    return (
      <section className="google-calendar-setup" aria-labelledby="google-calendar-title">
        <p className="app-settings__eyebrow" id="google-calendar-title">
          Google Calendar
        </p>
        <p className="app-settings__notice">
          Google Calendar connects only from the native desktop app. Local reminders work in this
          preview.
        </p>
      </section>
    );
  }

  return (
    <section className="google-calendar-setup" aria-labelledby="google-calendar-title">
      <div className="google-calendar-setup__header">
        <div>
          <p className="app-settings__eyebrow" id="google-calendar-title">
            Google Calendar
          </p>
          <span>Optional native OAuth connection</span>
        </div>
        <i
          aria-label={connected ? "Google Calendar connected" : "Google Calendar local only"}
          className={`app-settings__state app-settings__state--${connected ? "ready" : "stale"}`}
        />
      </div>
      {connected ? (
        <>
          <p className="app-settings__notice">
            Today’s Google events are read by the native provider and stay separate from local
            reminders.
          </p>
          <GoogleEventForm
            onCreated={(event) => {
              onEventCreated(event);
              setMessage(`Created “${event.title}” in Google Calendar.`);
            }}
          />
          <button
            className="provider-secret-form__disconnect"
            disabled={busy}
            onClick={disconnect}
            type="button"
          >
            Disconnect Google Calendar
          </button>
        </>
      ) : (
        <div className="google-calendar-setup__actions">
          <button
            className="glass-action glass-action--quiet"
            disabled={busy}
            onClick={beginConnection}
            type="button"
          >
            {pending ? "Reopen Google authorization" : "Connect Google Calendar"}
          </button>
          {pending ? (
            <button
              className="glass-action glass-action--quiet"
              disabled={busy}
              onClick={completeConnection}
              type="button"
            >
              I finished in the browser
            </button>
          ) : null}
        </div>
      )}
      <small className="google-calendar-setup__message" role="status">
        {message}
      </small>
    </section>
  );
}

function GoogleEventForm({ onCreated }: { onCreated: (event: CalendarEvent) => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      aria-label="Create a Google Calendar event"
      className="routine-setup-form google-calendar-setup__event-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const title = String(data.get("title") ?? "").trim();
        const startsAtInput = String(data.get("startsAt") ?? "");
        const endsAtInput = String(data.get("endsAt") ?? "");
        const allDay = data.get("allDay") === "on";
        const startsAt = allDay ? localDatePart(startsAtInput) : localDateTimeToIso(startsAtInput);
        const endsAt = endsAtInput
          ? allDay
            ? localDatePart(endsAtInput)
            : localDateTimeToIso(endsAtInput)
          : undefined;

        if (!title || !startsAt || (endsAtInput && !endsAt)) {
          setMessage("Give the event a title and a valid local start time.");
          return;
        }
        if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
          setMessage("The end time must be after the start time.");
          return;
        }

        setBusy(true);
        void createGoogleCalendarEvent({ title, startsAt, endsAt, allDay })
          .then((result) => {
            if (!result.ok) {
              setMessage(result.message);
              return;
            }
            onCreated(result.value);
            form.reset();
            setMessage("Event created in Google Calendar.");
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="routine-setup-form__title">
        <strong>Google event</strong>
        <span>Create in your primary calendar</span>
      </div>
      <label className="routine-setup-form__field">
        <span className="sr-only">Google Calendar event title</span>
        <input name="title" placeholder="Dinner reservation" required />
      </label>
      <label className="routine-setup-form__time">
        <span>Start</span>
        <input
          aria-label="Google Calendar event start"
          name="startsAt"
          required
          type="datetime-local"
        />
      </label>
      <label className="routine-setup-form__time">
        <span>End</span>
        <input aria-label="Google Calendar event end" name="endsAt" type="datetime-local" />
      </label>
      <label className="google-calendar-setup__all-day">
        <input name="allDay" type="checkbox" />
        <span>All day</span>
      </label>
      <button className="glass-action glass-action--quiet" disabled={busy} type="submit">
        Create Google event
      </button>
      {message ? (
        <small className="routine-setup-form__message" role="status">
          {message}
        </small>
      ) : null}
    </form>
  );
}

function localDateTimeToIso(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : undefined;
}

function localDatePart(value: string): string | undefined {
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00`))
    ? date
    : undefined;
}
