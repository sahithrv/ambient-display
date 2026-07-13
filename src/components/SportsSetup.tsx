import { useId, useMemo, useState, type FormEvent } from "react";

import type { ProviderStatus, SportsPreferences, SportsTeamPreference } from "../domain";
import { MAX_FAVORITE_SPORTS_TEAMS } from "../services/sportsSettings";
import "../styles/sports-setup.css";

export interface SportsSetupProps {
  preferences: SportsPreferences;
  /** Teams already present in normalized events; no additional request is made to show them. */
  availableTeams?: SportsTeamPreference[];
  providerStatus?: ProviderStatus;
  refreshing?: boolean;
  preview?: boolean;
  onChange: (preferences: SportsPreferences) => void;
  onRefresh?: () => void;
}

/** A browser-safe favorite-team editor. API keys never enter this component or its persisted data. */
export function SportsSetup({
  preferences,
  availableTeams = [],
  providerStatus,
  refreshing = false,
  preview = false,
  onChange,
  onRefresh,
}: SportsSetupProps) {
  const nameId = useId();
  const providerId = useId();
  const [message, setMessage] = useState("");
  const suggestedTeams = useMemo(
    () =>
      availableTeams.filter((team) => !containsTeam(preferences.favoriteTeams, team)).slice(0, 8),
    [availableTeams, preferences.favoriteTeams],
  );

  const addTeam = (team: SportsTeamPreference) => {
    if (containsTeam(preferences.favoriteTeams, team)) {
      setMessage(`${team.name} is already in your favorites.`);
      return false;
    }
    if (preferences.favoriteTeams.length >= MAX_FAVORITE_SPORTS_TEAMS) {
      setMessage(`Choose up to ${MAX_FAVORITE_SPORTS_TEAMS} favorite teams.`);
      return false;
    }
    onChange({
      ...preferences,
      favoriteTeams: [...preferences.favoriteTeams, team],
      showOnlyFavorites:
        preferences.favoriteTeams.length === 0 ? true : preferences.showOnlyFavorites,
    });
    setMessage(`${team.name} added. Teams with an ID also load nearby schedule results.`);
    return true;
  };

  const submitTeam = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = normalizedText(data.get("teamName"));
    const id = normalizedText(data.get("teamId"));
    if (!name || name.length > 128) {
      setMessage("Enter a team name of 128 characters or fewer.");
      return;
    }
    if (id && !/^\d{1,32}$/.test(id)) {
      setMessage("TheSportsDB team ID must contain digits only.");
      return;
    }
    if (addTeam({ name, ...(id ? { id } : {}) })) {
      form.reset();
    }
  };

  const removeTeam = (index: number) => {
    const favoriteTeams = preferences.favoriteTeams.filter((_, itemIndex) => itemIndex !== index);
    onChange({
      ...preferences,
      favoriteTeams,
      showOnlyFavorites: favoriteTeams.length > 0 && preferences.showOnlyFavorites,
    });
    setMessage("Favorite removed.");
  };

  const moveTeam = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= preferences.favoriteTeams.length) {
      return;
    }
    const favoriteTeams = [...preferences.favoriteTeams];
    [favoriteTeams[index], favoriteTeams[target]] = [favoriteTeams[target], favoriteTeams[index]];
    onChange({ ...preferences, favoriteTeams });
  };

  return (
    <section className="sports-setup" aria-labelledby={`${nameId}-heading`} aria-busy={refreshing}>
      <header className="sports-setup__header">
        <div>
          <p className="sports-setup__eyebrow">Sports ribbon</p>
          <h3 id={`${nameId}-heading`}>Your teams</h3>
          <span>Favorites stay calm, ordered, and local to this device.</span>
        </div>
        <div className="sports-setup__provider" aria-label="Sports provider status">
          <i
            className={`sports-setup__status sports-setup__status--${providerStatus?.state ?? "stale"}`}
            aria-hidden="true"
          />
          <span>{providerStatus?.message ?? (preview ? "Preview fixture" : "Not connected")}</span>
        </div>
      </header>

      <label className="sports-setup__visibility">
        <span>
          <strong>Show only favorites</strong>
          <small>Unrelated games disappear once at least one team is chosen.</small>
        </span>
        <input
          type="checkbox"
          checked={preferences.showOnlyFavorites}
          disabled={preferences.favoriteTeams.length === 0}
          onChange={(event) =>
            onChange({ ...preferences, showOnlyFavorites: event.currentTarget.checked })
          }
        />
      </label>

      <div className="sports-setup__favorites" aria-label="Favorite teams">
        {preferences.favoriteTeams.length === 0 ? (
          <div className="sports-setup__empty">
            <span aria-hidden="true">✦</span>
            <p>
              <strong>No teams selected</strong>
              Add a team below or choose one found in the current feed.
            </p>
          </div>
        ) : (
          preferences.favoriteTeams.map((team, index) => (
            <article className="sports-setup__team" key={team.id ? `id:${team.id}` : team.name}>
              <span className="sports-setup__monogram" aria-hidden="true">
                {teamMonogram(team.name)}
              </span>
              <div>
                <strong>{team.name}</strong>
                <span>
                  {[team.sport, team.league, team.id ? `ID ${team.id}` : "Name match only"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <div className="sports-setup__team-actions">
                <button
                  type="button"
                  onClick={() => moveTeam(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${team.name} earlier`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveTeam(index, 1)}
                  disabled={index === preferences.favoriteTeams.length - 1}
                  aria-label={`Move ${team.name} later`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="sports-setup__remove"
                  onClick={() => removeTeam(index)}
                  aria-label={`Remove ${team.name}`}
                >
                  Remove
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      {suggestedTeams.length > 0 ? (
        <div className="sports-setup__suggestions">
          <div>
            <strong>Available in the current feed</strong>
            <span>Quick add without another provider request</span>
          </div>
          <div className="sports-setup__suggestion-list">
            {suggestedTeams.map((team) => (
              <button
                type="button"
                key={team.id ? `id:${team.id}` : team.name}
                onClick={() => addTeam(team)}
              >
                <span>{teamMonogram(team.name)}</span>
                {team.name}
                <b aria-hidden="true">+</b>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form className="sports-setup__form" onSubmit={submitTeam} aria-label="Add a favorite team">
        <label htmlFor={nameId}>
          <span>Team name</span>
          <input
            id={nameId}
            name="teamName"
            maxLength={128}
            autoComplete="off"
            placeholder="Golden State Warriors"
          />
        </label>
        <label htmlFor={providerId}>
          <span>
            TheSportsDB ID <small>optional</small>
          </span>
          <input
            id={providerId}
            name="teamId"
            inputMode="numeric"
            pattern="[0-9]{1,32}"
            maxLength={32}
            autoComplete="off"
            placeholder="133600"
          />
        </label>
        <button className="glass-action glass-action--primary" type="submit">
          Add team
        </button>
      </form>

      <footer className="sports-setup__footer">
        <p>
          {preview
            ? "Preview mode uses deterministic games and never contacts TheSportsDB."
            : "An ID lets the native provider request bounded next/previous schedules. Name-only favorites still filter daily events."}
        </p>
        {onRefresh ? (
          <button
            type="button"
            className="glass-action glass-action--quiet"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh sports"}
          </button>
        ) : null}
      </footer>
      <p className="sports-setup__message" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}

function containsTeam(favorites: SportsTeamPreference[], candidate: SportsTeamPreference): boolean {
  return favorites.some((team) => {
    if (team.id && candidate.id) {
      return team.id === candidate.id;
    }
    return comparableName(team.name) === comparableName(candidate.name);
  });
}

function normalizedText(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return text || undefined;
}

function comparableName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function teamMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words.at(-1)?.[0] ?? ""}` : name.slice(0, 2))
    .toLocaleUpperCase("en-US")
    .slice(0, 2);
}
