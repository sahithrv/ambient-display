//! Backend-only provider boundaries.
//!
//! Credentials are accepted only by the narrow save command and are persisted
//! in the operating system credential store. Provider requests originate here,
//! never in the webview, so API keys and authorization headers do not enter
//! frontend state, browser storage, request logs, or Tauri Store files.

mod credentials;

use std::{
    collections::{HashMap, HashSet, VecDeque},
    fmt,
    io::{ErrorKind, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        mpsc::{self, Receiver, TryRecvError},
        Mutex, MutexGuard,
    },
    thread,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{
    DateTime, Datelike, Days, Duration as ChronoDuration, Local, LocalResult, NaiveDate,
    NaiveDateTime, NaiveTime, TimeZone,
};
use futures_util::{lock::Mutex as AsyncMutex, stream, StreamExt};
use rand::{rngs::OsRng, RngCore};
use reqwest::{
    header::{ACCEPT, CONTENT_LENGTH},
    multipart::{Form, Part},
    redirect::Policy,
    Client, StatusCode, Url,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri_plugin_opener::OpenerExt;

pub use credentials::ProviderSecretSlot;

use credentials::{
    validate_provider_secret, CredentialStore, CredentialStoreError, SecretValidationError,
};

const GITHUB_GRAPHQL_URL: &str = "https://api.github.com/graphql";
const SPORTS_DB_EVENTS_BY_DAY_URL: &str = "https://www.thesportsdb.com/api/v1/json";
const OPENAI_TRANSCRIPTIONS_URL: &str = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_TRANSCRIPTION_MODEL: &str = "gpt-4o-mini-transcribe";
const GOOGLE_OAUTH_AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_PRIMARY_EVENTS_URL: &str =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_CALENDAR_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_OAUTH_CALLBACK_PATH: &str = "/oauth2/callback";
const GOOGLE_OAUTH_CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const GOOGLE_OAUTH_ATTEMPT_TTL: Duration = Duration::from_secs(6 * 60);
const GOOGLE_CALENDAR_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

const MAX_TRANSCRIPTION_BYTES: usize = 10 * 1024 * 1024;
const MAX_TRANSCRIPTION_DURATION_MS: u32 = 60_000;
const MAX_TRANSCRIPT_CHARS: usize = 8_000;
const MAX_PROVIDER_RESPONSE_BYTES: u64 = 1024 * 1024;
const MAX_NORMALIZED_SPORTS_EVENTS: usize = 64;
const MAX_FAVORITE_SPORTS_TEAMS: usize = 8;
const MAX_TEAM_SCHEDULE_EVENTS_PER_DIRECTION: usize = 3;
const MAX_CONCURRENT_SPORTS_REQUESTS: usize = 4;
// TheSportsDB's free tier allows 30 requests per minute. Keep two requests of
// headroom and reserve an entire refresh before it starts so concurrent UI
// actions cannot accidentally burst through the provider allowance.
const SPORTS_PROVIDER_REQUEST_BUDGET: usize = 28;
const SPORTS_PROVIDER_REQUEST_WINDOW: Duration = Duration::from_secs(60);
const MAX_NORMALIZED_GOOGLE_EVENTS: usize = 64;
const MAX_GOOGLE_EVENT_TITLE_CHARS: usize = 256;
const MAX_GOOGLE_EVENT_DURATION_DAYS: i64 = 31;
const GITHUB_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const SPORTS_CACHE_TTL: Duration = Duration::from_secs(60);

/// Desktop OAuth clients are public clients: the identifier is safe to embed,
/// while refresh/access tokens are not. The build environment must provide it
/// explicitly; no frontend setting can supply or inspect this value.
const GOOGLE_OAUTH_CLIENT_ID: Option<&str> = option_env!("AMBIENT_GOOGLE_CLIENT_ID");

const GITHUB_TODAY_QUERY: &str = r#"
query TodayCommits($from: DateTime!, $to: DateTime!) {
  viewer {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
    }
  }
}
"#;

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProviderError {
    Validation {
        field: &'static str,
        message: String,
    },
    Unavailable {
        provider: &'static str,
        message: String,
        retryable: bool,
    },
    SecureStorage {
        message: String,
    },
}

impl fmt::Display for ProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Validation { message, .. }
            | Self::Unavailable { message, .. }
            | Self::SecureStorage { message } => formatter.write_str(message),
        }
    }
}

impl std::error::Error for ProviderError {}

/// `native` means a credential-backed backend request or cache was used. Mock
/// and unconfigured modes remain intentional browser/no-credential behavior.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderMode {
    Native,
    Mock,
    Unconfigured,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubCommitsResponse {
    /// This is deliberately specific: the count comes from GitHub's
    /// `totalCommitContributions`, not all contribution types.
    pub label: String,
    /// Retained for existing clients that already render the original field.
    pub count: u32,
    /// Clear frontend-friendly name for the same GitHub-authoritative count.
    pub commits: u32,
    pub local_day: Option<String>,
    pub mode: ProviderMode,
    pub stale: bool,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SportsRefreshResponse {
    pub mode: ProviderMode,
    /// Third-party payloads are normalized before this boundary is crossed.
    pub events: Vec<SportsEvent>,
    pub stale: bool,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SportsEvent {
    pub id: String,
    pub sport: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub league_id: Option<String>,
    pub league: String,
    pub start_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home_team_id: Option<String>,
    pub home_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub away_team_id: Option<String>,
    pub away_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home_badge_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub away_badge_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home_score: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub away_score: Option<u32>,
    pub status: SportsEventStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clock_or_period: Option<String>,
}

/// Google Calendar output is deliberately reduced to the same display-safe
/// shape as the local calendar model. Raw descriptions, attendees, locations,
/// conference links, and provider payloads never leave Rust.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarEvent {
    pub id: String,
    pub title: String,
    pub starts_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends_at: Option<String>,
    pub all_day: bool,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
}

/// Calendar reads retain their freshness signal so the UI can distinguish a
/// live day refresh from the short-lived in-memory fallback without receiving
/// any credential or raw Google payload data.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarTodayResponse {
    pub events: Vec<GoogleCalendarEvent>,
    pub stale: bool,
    pub message: String,
}

/// Returned by both the begin and complete OAuth commands. It intentionally
/// contains no authorization code, verifier, access token, or refresh token.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarOAuthResponse {
    pub connected: bool,
    pub pending: bool,
    pub message: String,
}

/// The webview may request a small, validated event shape, but it cannot
/// provide a calendar ID, OAuth token, attendee list, or arbitrary Google
/// event JSON. The provider always targets the authenticated user's primary
/// calendar.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendarEventCreateRequest {
    pub title: String,
    pub starts_at: String,
    pub ends_at: Option<String>,
    pub all_day: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SportsEventStatus {
    Scheduled,
    Live,
    Final,
    Postponed,
    Cancelled,
}

/// Audio is held only for the duration of one explicit transcription request.
/// It is not written to disk, emitted in an event, included in errors, or
/// logged. It is dropped after a response/error leaves this command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionRequest {
    pub mime_type: String,
    pub duration_ms: u32,
    pub explicit_push_to_talk: bool,
    pub audio: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResponse {
    pub mode: ProviderMode,
    pub transcript: Option<String>,
    pub audio_discarded: bool,
    pub fallback: String,
    pub message: String,
}

/// This status intentionally returns booleans only. It never returns secret
/// material, credential store paths, token prefixes, or provider headers.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureTokenStorageStatus {
    pub backend_only: bool,
    pub mode: ProviderMode,
    pub github_token_configured: bool,
    pub sports_api_key_configured: bool,
    pub openai_token_configured: bool,
    pub google_refresh_token_configured: bool,
    pub frontend_token_access: bool,
    pub secure_storage_available: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSecretMutationResponse {
    pub slot: ProviderSecretSlot,
    pub configured: bool,
    pub message: String,
}

#[derive(Clone)]
struct Cached<T> {
    key: String,
    saved_at: Instant,
    value: T,
}

#[derive(Default)]
struct ProviderCache {
    github: Option<Cached<GithubCommitsResponse>>,
    sports: Option<Cached<SportsRefreshResponse>>,
    google_calendar: Option<Cached<Vec<GoogleCalendarEvent>>>,
}

/// One native-only OAuth attempt at a time. The loopback listener reports a
/// code over this in-process channel; only `complete_google_calendar_oauth`
/// consumes it, then exchanges it with the PKCE verifier kept here.
struct GoogleOAuthAttempt {
    code_verifier: String,
    redirect_uri: String,
    started_at: Instant,
    callback_receiver: Receiver<Result<GoogleOAuthCallback, ProviderError>>,
    cancellation_sender: mpsc::SyncSender<()>,
}

struct GoogleOAuthCallback {
    code: String,
}

/// The application owns one service. Its cache is in-memory only, so data is
/// not written alongside credentials and disconnecting a provider clears it.
pub struct ProviderService {
    credentials: CredentialStore,
    http: Option<Client>,
    cache: Mutex<ProviderCache>,
    sports_refresh_gate: AsyncMutex<()>,
    sports_request_times: Mutex<VecDeque<Instant>>,
    google_oauth_attempt: Mutex<Option<GoogleOAuthAttempt>>,
}

impl Default for ProviderService {
    fn default() -> Self {
        Self::new()
    }
}

impl ProviderService {
    pub fn new() -> Self {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(4))
            .timeout(Duration::from_secs(10))
            .redirect(Policy::none())
            .user_agent("AmbientGlass/0.1 (native provider boundary)")
            .build()
            .ok();

        Self {
            credentials: CredentialStore,
            http,
            cache: Mutex::new(ProviderCache::default()),
            sports_refresh_gate: AsyncMutex::new(()),
            sports_request_times: Mutex::new(VecDeque::new()),
            google_oauth_attempt: Mutex::new(None),
        }
    }

    pub async fn github_commits(
        &self,
        local_day: Option<&str>,
    ) -> Result<GithubCommitsResponse, ProviderError> {
        let requested_local_day = local_day.map(validate_local_day).transpose()?;
        let effective_local_day = requested_local_day
            .clone()
            .unwrap_or_else(today_in_local_timezone);

        let Some(token) = self.load_valid_secret(ProviderSecretSlot::GithubToken)? else {
            return Ok(mock_github_commits(requested_local_day));
        };

        if let Some(cached) = self.fresh_github_cache(&effective_local_day) {
            return Ok(cached);
        }

        match self
            .fetch_github_commits(token, &effective_local_day, requested_local_day)
            .await
        {
            Ok(response) => {
                self.cache_lock().github = Some(Cached {
                    key: effective_local_day,
                    saved_at: Instant::now(),
                    value: response.clone(),
                });
                Ok(response)
            }
            Err(error) => self.stale_github_cache(&effective_local_day).ok_or(error),
        }
    }

    pub async fn refresh_sports(
        &self,
        local_day: Option<&str>,
        favorite_team_ids: Option<Vec<String>>,
    ) -> Result<SportsRefreshResponse, ProviderError> {
        let local_day = local_day
            .map(validate_local_day)
            .transpose()?
            .unwrap_or_else(today_in_local_timezone);
        let favorite_team_ids = validate_favorite_team_ids(favorite_team_ids)?;
        let cache_key = sports_cache_key(&local_day, &favorite_team_ids);
        let Some(api_key) = self.load_valid_secret(ProviderSecretSlot::SportsApiKey)? else {
            return Ok(mock_sports_response());
        };

        if let Some(cached) = self.fresh_sports_cache(&cache_key) {
            return Ok(cached);
        }

        // Serialize refreshes before reserving request credits. A second call
        // for the same selection can then reuse the cache populated by the
        // first call instead of spending another provider request.
        let _refresh_guard = self.sports_refresh_gate.lock().await;
        if let Some(cached) = self.fresh_sports_cache(&cache_key) {
            return Ok(cached);
        }
        self.reserve_sports_requests(sports_refresh_request_count(favorite_team_ids.len()))?;

        match self
            .fetch_sports_events(api_key, &local_day, &favorite_team_ids)
            .await
        {
            Ok(response) => {
                self.cache_lock().sports = Some(Cached {
                    key: cache_key.clone(),
                    saved_at: Instant::now(),
                    value: response.clone(),
                });
                Ok(response)
            }
            Err(error) => self.stale_sports_cache(&cache_key).ok_or(error),
        }
    }

    pub async fn transcribe(
        &self,
        request: TranscriptionRequest,
    ) -> Result<TranscriptionResponse, ProviderError> {
        validate_transcription_request(&request)?;

        let Some(api_key) = self.load_valid_secret(ProviderSecretSlot::OpenaiApiKey)? else {
            // The request owns the Vec. Dropping it here keeps missing-credential
            // behavior deterministic and guarantees it is never persisted.
            drop(request);
            return Ok(TranscriptionResponse {
                mode: ProviderMode::Unconfigured,
                transcript: None,
                audio_discarded: true,
                fallback: "typed-command".to_owned(),
                message: "Voice transcription is not configured; use the typed command input."
                    .to_owned(),
            });
        };

        self.fetch_openai_transcription(api_key, request).await
    }

    /// Starts an installed-app OAuth authorization in the default system
    /// browser. The webview gets only a pending/connected status; PKCE state,
    /// verifier, callback code, and tokens stay native-only.
    pub fn begin_google_calendar_oauth<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
    ) -> Result<GoogleCalendarOAuthResponse, ProviderError> {
        let client_id = google_oauth_client_id()?;
        let mut attempt_lock = self.google_oauth_attempt_lock();
        if attempt_lock
            .as_ref()
            .is_some_and(|existing| existing.started_at.elapsed() < GOOGLE_OAUTH_ATTEMPT_TTL)
        {
            return Ok(GoogleCalendarOAuthResponse {
                connected: false,
                pending: true,
                message: "Google Calendar authorization is already waiting for browser consent."
                    .to_owned(),
            });
        }
        if let Some(expired_attempt) = attempt_lock.take() {
            cancel_google_oauth_attempt(expired_attempt);
        }

        let listener =
            TcpListener::bind(("127.0.0.1", 0)).map_err(|_| ProviderError::Unavailable {
                provider: "Google Calendar",
                message:
                    "Could not start the local Google Calendar authorization callback. Try again."
                        .to_owned(),
                retryable: true,
            })?;
        listener
            .set_nonblocking(true)
            .map_err(|_| ProviderError::Unavailable {
                provider: "Google Calendar",
                message:
                    "Could not prepare the local Google Calendar authorization callback. Try again."
                        .to_owned(),
                retryable: true,
            })?;
        let port = listener
            .local_addr()
            .map_err(|_| ProviderError::Unavailable {
                provider: "Google Calendar",
                message:
                    "Could not prepare the local Google Calendar authorization callback. Try again."
                        .to_owned(),
                retryable: true,
            })?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{port}{GOOGLE_OAUTH_CALLBACK_PATH}");
        let state = random_urlsafe_value(32);
        let code_verifier = random_urlsafe_value(64);
        let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
        let authorization_url =
            google_authorization_url(client_id, &redirect_uri, &state, &code_challenge)?;
        let (callback_sender, callback_receiver) = mpsc::sync_channel(1);
        let (cancellation_sender, cancellation_receiver) = mpsc::sync_channel(1);
        let expected_state = state.clone();

        *attempt_lock = Some(GoogleOAuthAttempt {
            code_verifier,
            redirect_uri,
            started_at: Instant::now(),
            callback_receiver,
            cancellation_sender,
        });
        drop(attempt_lock);

        if app
            .opener()
            .open_url(authorization_url.as_str(), None::<&str>)
            .is_err()
        {
            self.clear_google_oauth_attempt();
            return Err(ProviderError::Unavailable {
                provider: "Google Calendar",
                message: "Could not open the system browser for Google Calendar authorization."
                    .to_owned(),
                retryable: true,
            });
        }

        // The listener is deliberately detached from the webview lifetime. It
        // accepts a single state-validated loopback callback and times out; the
        // authorization code never becomes a Tauri event or command argument.
        tauri::async_runtime::spawn_blocking(move || {
            let result =
                receive_google_oauth_callback(listener, &expected_state, cancellation_receiver);
            let _ = callback_sender.send(result);
        });

        Ok(GoogleCalendarOAuthResponse {
            connected: false,
            pending: true,
            message: "Browser opened for Google Calendar authorization. Return here after granting access."
                .to_owned(),
        })
    }

    /// Polls a pending loopback callback and exchanges a completed code using
    /// its native-only PKCE verifier. Only a valid refresh token is persisted
    /// in the OS credential store.
    pub async fn complete_google_calendar_oauth(
        &self,
    ) -> Result<GoogleCalendarOAuthResponse, ProviderError> {
        let attempt_and_callback = {
            let mut attempt_lock = self.google_oauth_attempt_lock();
            let Some(started_at) = attempt_lock.as_ref().map(|attempt| attempt.started_at) else {
                let connected = self
                    .load_valid_secret(ProviderSecretSlot::GoogleRefreshToken)?
                    .is_some();
                return Ok(GoogleCalendarOAuthResponse {
                    connected,
                    pending: false,
                    message: if connected {
                        "Google Calendar is already connected through native secure storage."
                            .to_owned()
                    } else {
                        "No Google Calendar authorization is waiting. Start a connection first."
                            .to_owned()
                    },
                });
            };

            if started_at.elapsed() > GOOGLE_OAUTH_ATTEMPT_TTL {
                if let Some(expired_attempt) = attempt_lock.take() {
                    cancel_google_oauth_attempt(expired_attempt);
                }
                return Err(ProviderError::Unavailable {
                    provider: "Google Calendar",
                    message: "Google Calendar authorization timed out. Start the connection again."
                        .to_owned(),
                    retryable: true,
                });
            }

            let callback_status = attempt_lock
                .as_mut()
                .expect("Google OAuth attempt disappeared while polling it")
                .callback_receiver
                .try_recv();
            match callback_status {
                Ok(callback) => {
                    let attempt = attempt_lock
                        .take()
                        .expect("Google OAuth attempt disappeared while completing it");
                    Some((attempt, callback))
                }
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => {
                    if let Some(stopped_attempt) = attempt_lock.take() {
                        cancel_google_oauth_attempt(stopped_attempt);
                    }
                    return Err(ProviderError::Unavailable {
                        provider: "Google Calendar",
                        message: "Google Calendar authorization stopped before completing. Start it again."
                            .to_owned(),
                        retryable: true,
                    });
                }
            }
        };

        let Some((attempt, callback)) = attempt_and_callback else {
            return Ok(GoogleCalendarOAuthResponse {
                connected: false,
                pending: true,
                message: "Waiting for Google Calendar authorization in the system browser."
                    .to_owned(),
            });
        };
        let callback = callback?;
        let client_id = google_oauth_client_id()?;
        let refresh_token = self
            .exchange_google_authorization_code(
                client_id,
                &attempt.redirect_uri,
                &attempt.code_verifier,
                callback.code,
            )
            .await?;
        validate_provider_secret(ProviderSecretSlot::GoogleRefreshToken, &refresh_token)
            .map_err(|_| ProviderError::Unavailable {
                provider: "Google Calendar",
                message: "Google Calendar returned an invalid authorization result. Start the connection again."
                    .to_owned(),
                retryable: true,
            })?;
        self.credentials
            .save(ProviderSecretSlot::GoogleRefreshToken, &refresh_token)
            .map_err(secure_storage_error)?;
        self.clear_cache_for(ProviderSecretSlot::GoogleRefreshToken);

        Ok(GoogleCalendarOAuthResponse {
            connected: true,
            pending: false,
            message: "Google Calendar connected with native secure storage.".to_owned(),
        })
    }

    /// Removes the refresh token and all in-memory calendar/OAuth state. This
    /// is separate from the generic secret command so a UI can disconnect
    /// Calendar without ever handling a credential value.
    pub fn disconnect_google_calendar(&self) -> Result<GoogleCalendarOAuthResponse, ProviderError> {
        self.credentials
            .delete(ProviderSecretSlot::GoogleRefreshToken)
            .map_err(secure_storage_error)?;
        self.clear_cache_for(ProviderSecretSlot::GoogleRefreshToken);
        self.clear_google_oauth_attempt();
        Ok(GoogleCalendarOAuthResponse {
            connected: false,
            pending: false,
            message: "Google Calendar disconnected and its native credential was removed."
                .to_owned(),
        })
    }

    /// Reads only normalized events intersecting one local day. Existing
    /// callers may omit the day, preserving the prior `get_google_calendar_today`
    /// command shape while avoiding any browser-side token work.
    pub async fn google_calendar_today(
        &self,
        local_day: Option<&str>,
    ) -> Result<GoogleCalendarTodayResponse, ProviderError> {
        let local_day = local_day
            .map(validate_local_day)
            .transpose()?
            .unwrap_or_else(today_in_local_timezone);
        let client_id = google_oauth_client_id()?;
        let Some(refresh_token) = self.load_valid_secret(ProviderSecretSlot::GoogleRefreshToken)?
        else {
            return Err(ProviderError::Unavailable {
                provider: "Google Calendar",
                message: "Google Calendar is not connected. Connect it in settings first."
                    .to_owned(),
                retryable: false,
            });
        };

        if let Some(cached) = self.fresh_google_calendar_cache(&local_day) {
            return Ok(GoogleCalendarTodayResponse {
                events: cached,
                stale: false,
                message: "Using recently refreshed Google Calendar events.".to_owned(),
            });
        }

        let access_token = match self
            .refresh_google_access_token(client_id, refresh_token)
            .await
        {
            Ok(token) => token,
            Err(error) => {
                return self
                    .stale_google_calendar_cache(&local_day)
                    .map(stale_google_calendar_response)
                    .ok_or(error)
            }
        };
        match self
            .fetch_google_calendar_today(&access_token, &local_day)
            .await
        {
            Ok(events) => {
                self.cache_lock().google_calendar = Some(Cached {
                    key: local_day,
                    saved_at: Instant::now(),
                    value: events.clone(),
                });
                Ok(GoogleCalendarTodayResponse {
                    events,
                    stale: false,
                    message: "Google Calendar refreshed.".to_owned(),
                })
            }
            Err(error) => self
                .stale_google_calendar_cache(&local_day)
                .map(stale_google_calendar_response)
                .ok_or(error),
        }
    }

    /// Creates one bounded event in the authenticated user's primary Google
    /// Calendar. It deliberately omits attendees, notifications, attachments,
    /// and arbitrary provider fields.
    pub async fn create_google_calendar_event(
        &self,
        request: GoogleCalendarEventCreateRequest,
    ) -> Result<GoogleCalendarEvent, ProviderError> {
        let client_id = google_oauth_client_id()?;
        let Some(refresh_token) = self.load_valid_secret(ProviderSecretSlot::GoogleRefreshToken)?
        else {
            return Err(ProviderError::Unavailable {
                provider: "Google Calendar",
                message: "Google Calendar is not connected. Connect it in settings first."
                    .to_owned(),
                retryable: false,
            });
        };
        let payload = google_calendar_create_payload(request)?;
        let access_token = self
            .refresh_google_access_token(client_id, refresh_token)
            .await?;
        let event = self
            .insert_google_calendar_event(&access_token, payload)
            .await?;
        // A newly created event can alter today's first event, so force the
        // next read to fetch rather than retain an old ribbon/card result.
        self.cache_lock().google_calendar = None;
        Ok(event)
    }

    pub fn save_secret(
        &self,
        slot: ProviderSecretSlot,
        value: String,
    ) -> Result<ProviderSecretMutationResponse, ProviderError> {
        validate_provider_secret(slot, &value)
            .map_err(|error| secret_validation_error(slot, error))?;
        self.credentials
            .save(slot, &value)
            .map_err(secure_storage_error)?;
        self.clear_cache_for(slot);
        if matches!(slot, ProviderSecretSlot::GoogleRefreshToken) {
            self.clear_google_oauth_attempt();
        }

        Ok(ProviderSecretMutationResponse {
            slot,
            configured: true,
            message: format!(
                "{} credential saved in native secure storage.",
                slot.display_name()
            ),
        })
    }

    pub fn delete_secret(
        &self,
        slot: ProviderSecretSlot,
    ) -> Result<ProviderSecretMutationResponse, ProviderError> {
        self.credentials
            .delete(slot)
            .map_err(secure_storage_error)?;
        self.clear_cache_for(slot);
        if matches!(slot, ProviderSecretSlot::GoogleRefreshToken) {
            self.clear_google_oauth_attempt();
        }

        Ok(ProviderSecretMutationResponse {
            slot,
            configured: false,
            message: format!(
                "{} credential removed from native secure storage.",
                slot.display_name()
            ),
        })
    }

    pub fn secret_storage_status(&self) -> SecureTokenStorageStatus {
        let mut secure_storage_available = true;
        let github_token_configured = self.slot_is_configured(
            ProviderSecretSlot::GithubToken,
            &mut secure_storage_available,
        );
        let sports_api_key_configured = self.slot_is_configured(
            ProviderSecretSlot::SportsApiKey,
            &mut secure_storage_available,
        );
        let openai_token_configured = self.slot_is_configured(
            ProviderSecretSlot::OpenaiApiKey,
            &mut secure_storage_available,
        );
        let google_refresh_token_configured = self.slot_is_configured(
            ProviderSecretSlot::GoogleRefreshToken,
            &mut secure_storage_available,
        );
        let any_configured = github_token_configured
            || sports_api_key_configured
            || openai_token_configured
            || google_refresh_token_configured;

        let (mode, message) = if !secure_storage_available {
            (
                ProviderMode::Unconfigured,
                "Secure credential storage is unavailable on this device.".to_owned(),
            )
        } else if any_configured {
            (
                ProviderMode::Native,
                "Provider credentials are stored in native secure storage.".to_owned(),
            )
        } else {
            (
                ProviderMode::Unconfigured,
                "No provider credentials are stored on this device.".to_owned(),
            )
        };

        SecureTokenStorageStatus {
            backend_only: true,
            mode,
            github_token_configured,
            sports_api_key_configured,
            openai_token_configured,
            google_refresh_token_configured,
            frontend_token_access: false,
            secure_storage_available,
            message,
        }
    }

    async fn fetch_github_commits(
        &self,
        token: String,
        effective_local_day: &str,
        requested_local_day: Option<String>,
    ) -> Result<GithubCommitsResponse, ProviderError> {
        let (from, to) = github_day_bounds(effective_local_day)?;
        let payload = GithubGraphqlRequest {
            query: GITHUB_TODAY_QUERY,
            variables: GithubGraphqlVariables { from, to },
        };
        let response = self
            .client()?
            .post(GITHUB_GRAPHQL_URL)
            .header(ACCEPT, "application/json")
            .bearer_auth(token)
            .json(&payload)
            .send()
            .await
            .map_err(|_| provider_temporarily_unavailable("GitHub"))?;

        if !response.status().is_success() {
            return Err(provider_http_error("GitHub", response.status()));
        }
        let payload: GithubGraphqlEnvelope = parse_bounded_json(response, "GitHub").await?;
        if payload
            .errors
            .as_ref()
            .is_some_and(|errors| !errors.is_empty())
        {
            return Err(ProviderError::Unavailable {
                provider: "GitHub",
                message:
                    "GitHub could not provide contribution data. Reconnect GitHub in settings."
                        .to_owned(),
                retryable: false,
            });
        }

        let commits = payload
            .data
            .and_then(|data| data.viewer)
            .map(|viewer| viewer.contributions_collection.total_commit_contributions)
            .ok_or_else(|| ProviderError::Unavailable {
                provider: "GitHub",
                message:
                    "GitHub could not provide contribution data. Reconnect GitHub in settings."
                        .to_owned(),
                retryable: false,
            })?;

        Ok(GithubCommitsResponse {
            label: "Commits counted by GitHub".to_owned(),
            count: commits,
            commits,
            local_day: requested_local_day,
            mode: ProviderMode::Native,
            stale: false,
            message: "GitHub contribution count refreshed.".to_owned(),
        })
    }

    async fn fetch_sports_events(
        &self,
        api_key: String,
        local_day: &str,
        favorite_team_ids: &[String],
    ) -> Result<SportsRefreshResponse, ProviderError> {
        // The daily request retains broad ambient coverage. Each favorite ID
        // adds exactly two fixed schedule calls; validation caps the total at
        // 17 requests and this stream caps concurrent provider pressure at 4.
        let mut requests: Vec<(String, String, String, Option<String>)> = vec![(
            "eventsday.php".to_owned(),
            "d".to_owned(),
            local_day.to_owned(),
            None,
        )];
        for team_id in favorite_team_ids {
            requests.push((
                "eventsnext.php".to_owned(),
                "id".to_owned(),
                team_id.clone(),
                Some(team_id.clone()),
            ));
            requests.push((
                "eventslast.php".to_owned(),
                "id".to_owned(),
                team_id.clone(),
                Some(team_id.clone()),
            ));
        }

        let mut results = stream::iter(requests.into_iter().enumerate().map(
            |(index, (endpoint, query_name, query_value, expected_team_id))| {
                let api_key = api_key.clone();
                async move {
                    (
                        index,
                        expected_team_id,
                        self.fetch_sports_event_list(
                            &api_key,
                            &endpoint,
                            &query_name,
                            &query_value,
                        )
                        .await,
                    )
                }
            },
        ))
        .buffer_unordered(MAX_CONCURRENT_SPORTS_REQUESTS)
        .collect::<Vec<_>>()
        .await;
        results.sort_by_key(|(index, _, _)| *index);

        let mut favorite_events = Vec::new();
        let mut daily_events = Vec::new();
        let mut first_error = None;
        let mut successful_requests = 0usize;
        let mut failed_requests = 0usize;
        for (_, expected_team_id, result) in results {
            match result {
                Ok(events) => {
                    successful_requests += 1;
                    if let Some(expected_team_id) = expected_team_id {
                        favorite_events.extend(
                            events
                                .into_iter()
                                .filter(|event| sports_event_has_team(event, &expected_team_id))
                                .take(MAX_TEAM_SCHEDULE_EVENTS_PER_DIRECTION),
                        );
                    } else {
                        daily_events.extend(events);
                    }
                }
                Err(error) => {
                    failed_requests += 1;
                    if first_error.is_none() {
                        first_error = Some(error);
                    }
                }
            }
        }
        if successful_requests == 0 {
            return Err(
                first_error.unwrap_or_else(|| provider_temporarily_unavailable("TheSportsDB"))
            );
        }

        // Favorite schedules enter first so a large premium daily feed cannot
        // evict the teams the user explicitly selected. A more informative
        // daily duplicate (for example a live score) replaces its schedule copy.
        let mut events = Vec::new();
        let mut indexes = HashMap::new();
        for event in favorite_events {
            merge_sports_event(&mut events, &mut indexes, event);
        }
        for event in daily_events {
            merge_sports_event(&mut events, &mut indexes, event);
        }
        events.truncate(MAX_NORMALIZED_SPORTS_EVENTS);

        let message = if favorite_team_ids.is_empty() {
            "Sports events refreshed.".to_owned()
        } else if failed_requests == 0 {
            "Sports events and favorite-team schedules refreshed.".to_owned()
        } else {
            format!(
                "Sports refreshed with {failed_requests} temporarily unavailable schedule request(s)."
            )
        };

        Ok(SportsRefreshResponse {
            mode: ProviderMode::Native,
            events,
            stale: false,
            message,
        })
    }

    async fn fetch_sports_event_list(
        &self,
        api_key: &str,
        endpoint_name: &str,
        query_name: &str,
        query_value: &str,
    ) -> Result<Vec<SportsEvent>, ProviderError> {
        // v1 places its key in the path. The key is validated before use and
        // neither the request URL nor provider error body crosses this boundary.
        let endpoint = format!("{SPORTS_DB_EVENTS_BY_DAY_URL}/{api_key}/{endpoint_name}");
        let endpoint =
            Url::parse(&endpoint).map_err(|_| provider_temporarily_unavailable("TheSportsDB"))?;
        let response = self
            .client()?
            .get(endpoint)
            .query(&[(query_name, query_value)])
            .header(ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| provider_temporarily_unavailable("TheSportsDB"))?;
        if !response.status().is_success() {
            return Err(provider_http_error("TheSportsDB", response.status()));
        }
        let payload: TheSportsDbEventsResponse =
            parse_bounded_json(response, "TheSportsDB").await?;
        Ok(payload
            .events
            .unwrap_or_default()
            .into_iter()
            .filter_map(normalize_sports_event)
            .take(MAX_NORMALIZED_SPORTS_EVENTS)
            .collect())
    }

    async fn fetch_openai_transcription(
        &self,
        api_key: String,
        request: TranscriptionRequest,
    ) -> Result<TranscriptionResponse, ProviderError> {
        let extension = audio_extension(&request.mime_type);
        let mime_type = request.mime_type;
        let audio_part = Part::bytes(request.audio)
            .file_name(format!("push-to-talk.{extension}"))
            .mime_str(&mime_type)
            .map_err(|_| ProviderError::Validation {
                field: "mimeType",
                message: "Voice capture has an unsupported media type.".to_owned(),
            })?;
        let form = Form::new()
            .text("model", OPENAI_TRANSCRIPTION_MODEL)
            .part("file", audio_part);
        let response = self
            .client()?
            .post(OPENAI_TRANSCRIPTIONS_URL)
            .header(ACCEPT, "application/json")
            .bearer_auth(api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|_| provider_temporarily_unavailable("OpenAI"))?;

        if !response.status().is_success() {
            return Err(provider_http_error("OpenAI", response.status()));
        }
        let payload: OpenAiTranscriptionResponse = parse_bounded_json(response, "OpenAI").await?;
        let transcript = payload.text.unwrap_or_default().trim().to_owned();
        if transcript.is_empty() || transcript.chars().count() > MAX_TRANSCRIPT_CHARS {
            return Err(ProviderError::Unavailable {
                provider: "OpenAI",
                message: "OpenAI returned no usable transcription. Use the typed command input."
                    .to_owned(),
                retryable: false,
            });
        }

        Ok(TranscriptionResponse {
            mode: ProviderMode::Native,
            transcript: Some(transcript),
            audio_discarded: true,
            fallback: "none".to_owned(),
            message: "Voice command transcribed by the configured provider.".to_owned(),
        })
    }

    async fn exchange_google_authorization_code(
        &self,
        client_id: &str,
        redirect_uri: &str,
        code_verifier: &str,
        code: String,
    ) -> Result<String, ProviderError> {
        let response = self
            .client()?
            .post(GOOGLE_OAUTH_TOKEN_URL)
            .header(ACCEPT, "application/json")
            .form(&[
                ("code", code.as_str()),
                ("client_id", client_id),
                ("redirect_uri", redirect_uri),
                ("code_verifier", code_verifier),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|_| provider_temporarily_unavailable("Google Calendar"))?;
        if !response.status().is_success() {
            return Err(google_oauth_http_error(response.status()));
        }
        let payload: GoogleOAuthTokenResponse =
            parse_bounded_json(response, "Google Calendar").await?;
        payload
            .refresh_token
            .filter(|value| is_valid_google_token_value(value))
            .ok_or_else(|| ProviderError::Unavailable {
                provider: "Google Calendar",
                message:
                    "Google did not provide a refresh token. Reconnect and grant Calendar access."
                        .to_owned(),
                retryable: true,
            })
    }

    async fn refresh_google_access_token(
        &self,
        client_id: &str,
        refresh_token: String,
    ) -> Result<String, ProviderError> {
        let response = self
            .client()?
            .post(GOOGLE_OAUTH_TOKEN_URL)
            .header(ACCEPT, "application/json")
            .form(&[
                ("client_id", client_id),
                ("refresh_token", refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|_| provider_temporarily_unavailable("Google Calendar"))?;
        if !response.status().is_success() {
            return Err(google_oauth_http_error(response.status()));
        }
        let payload: GoogleOAuthTokenResponse =
            parse_bounded_json(response, "Google Calendar").await?;
        payload
            .access_token
            .filter(|value| is_valid_google_token_value(value))
            .ok_or_else(|| ProviderError::Unavailable {
                provider: "Google Calendar",
                message:
                    "Google Calendar returned no usable access token. Reconnect and try again."
                        .to_owned(),
                retryable: false,
            })
    }

    async fn fetch_google_calendar_today(
        &self,
        access_token: &str,
        local_day: &str,
    ) -> Result<Vec<GoogleCalendarEvent>, ProviderError> {
        let (time_min, time_max) = google_day_bounds(local_day)?;
        let endpoint = Url::parse(GOOGLE_CALENDAR_PRIMARY_EVENTS_URL).map_err(|_| {
            ProviderError::Unavailable {
                provider: "Google Calendar",
                message: "Google Calendar endpoint configuration is invalid.".to_owned(),
                retryable: false,
            }
        })?;
        let response = self
            .client()?
            .get(endpoint)
            .header(ACCEPT, "application/json")
            .bearer_auth(access_token)
            .query(&[
                ("timeMin", time_min.as_str()),
                ("timeMax", time_max.as_str()),
                ("singleEvents", "true"),
                ("orderBy", "startTime"),
                ("maxResults", "64"),
            ])
            .send()
            .await
            .map_err(|_| provider_temporarily_unavailable("Google Calendar"))?;
        if !response.status().is_success() {
            return Err(provider_http_error("Google Calendar", response.status()));
        }
        let payload: GoogleCalendarEventsResponse =
            parse_bounded_json(response, "Google Calendar").await?;
        Ok(payload
            .items
            .unwrap_or_default()
            .into_iter()
            .filter_map(normalize_google_calendar_event)
            .take(MAX_NORMALIZED_GOOGLE_EVENTS)
            .collect())
    }

    async fn insert_google_calendar_event(
        &self,
        access_token: &str,
        payload: GoogleCalendarCreatePayload,
    ) -> Result<GoogleCalendarEvent, ProviderError> {
        let response = self
            .client()?
            .post(GOOGLE_CALENDAR_PRIMARY_EVENTS_URL)
            .header(ACCEPT, "application/json")
            .bearer_auth(access_token)
            .json(&payload)
            .send()
            .await
            .map_err(|_| provider_temporarily_unavailable("Google Calendar"))?;
        if !response.status().is_success() {
            return Err(provider_http_error("Google Calendar", response.status()));
        }
        let payload: GoogleCalendarApiEvent =
            parse_bounded_json(response, "Google Calendar").await?;
        normalize_google_calendar_event(payload).ok_or_else(|| ProviderError::Unavailable {
            provider: "Google Calendar",
            message: "Google Calendar returned an invalid event. Try again.".to_owned(),
            retryable: true,
        })
    }

    fn client(&self) -> Result<&Client, ProviderError> {
        self.http
            .as_ref()
            .ok_or_else(|| ProviderError::Unavailable {
                provider: "Network",
                message: "Native provider networking is unavailable in this build.".to_owned(),
                retryable: false,
            })
    }

    fn load_valid_secret(&self, slot: ProviderSecretSlot) -> Result<Option<String>, ProviderError> {
        let credential = self.credentials.load(slot).map_err(secure_storage_error)?;
        match credential {
            None => Ok(None),
            Some(value) => validate_provider_secret(slot, &value)
                .map(|()| Some(value))
                .map_err(|_| ProviderError::SecureStorage {
                    message: format!(
                        "The saved {} credential is invalid. Replace it in settings.",
                        slot.display_name()
                    ),
                }),
        }
    }

    fn slot_is_configured(
        &self,
        slot: ProviderSecretSlot,
        secure_storage_available: &mut bool,
    ) -> bool {
        match self.credentials.load(slot) {
            Ok(Some(value)) => validate_provider_secret(slot, &value).is_ok(),
            Ok(None) => false,
            Err(_) => {
                *secure_storage_available = false;
                false
            }
        }
    }

    fn fresh_github_cache(&self, local_day: &str) -> Option<GithubCommitsResponse> {
        let cache = self.cache_lock();
        let cached = cache.github.as_ref()?;
        if cached.key != local_day || cached.saved_at.elapsed() > GITHUB_CACHE_TTL {
            return None;
        }
        let mut response = cached.value.clone();
        response.stale = false;
        response.message = "Using recently fetched GitHub data.".to_owned();
        Some(response)
    }

    fn stale_github_cache(&self, local_day: &str) -> Option<GithubCommitsResponse> {
        let cache = self.cache_lock();
        let cached = cache.github.as_ref()?;
        if cached.key != local_day {
            return None;
        }
        let mut response = cached.value.clone();
        response.stale = true;
        response.mode = ProviderMode::Native;
        response.message = "GitHub is unavailable; showing cached data.".to_owned();
        Some(response)
    }

    fn fresh_sports_cache(&self, local_day: &str) -> Option<SportsRefreshResponse> {
        let cache = self.cache_lock();
        let cached = cache.sports.as_ref()?;
        if cached.key != local_day || cached.saved_at.elapsed() > SPORTS_CACHE_TTL {
            return None;
        }
        let mut response = cached.value.clone();
        response.stale = false;
        response.message = "Using recently fetched sports data.".to_owned();
        Some(response)
    }

    fn stale_sports_cache(&self, local_day: &str) -> Option<SportsRefreshResponse> {
        let cache = self.cache_lock();
        let cached = cache.sports.as_ref()?;
        if cached.key != local_day {
            return None;
        }
        let mut response = cached.value.clone();
        response.stale = true;
        response.mode = ProviderMode::Native;
        response.message = "Sports provider is unavailable; showing cached data.".to_owned();
        Some(response)
    }

    fn fresh_google_calendar_cache(&self, local_day: &str) -> Option<Vec<GoogleCalendarEvent>> {
        let cache = self.cache_lock();
        let cached = cache.google_calendar.as_ref()?;
        if cached.key != local_day || cached.saved_at.elapsed() > GOOGLE_CALENDAR_CACHE_TTL {
            return None;
        }
        Some(cached.value.clone())
    }

    fn stale_google_calendar_cache(&self, local_day: &str) -> Option<Vec<GoogleCalendarEvent>> {
        let cache = self.cache_lock();
        let cached = cache.google_calendar.as_ref()?;
        (cached.key == local_day).then(|| cached.value.clone())
    }

    fn clear_cache_for(&self, slot: ProviderSecretSlot) {
        let mut cache = self.cache_lock();
        match slot {
            ProviderSecretSlot::GithubToken => cache.github = None,
            ProviderSecretSlot::SportsApiKey => cache.sports = None,
            ProviderSecretSlot::GoogleRefreshToken => cache.google_calendar = None,
            ProviderSecretSlot::OpenaiApiKey => {}
        }
    }

    fn cache_lock(&self) -> MutexGuard<'_, ProviderCache> {
        // A cache poisoning event must not make a credential save/delete fail or
        // preserve stale data indefinitely. Cache contents contain no secrets.
        match self.cache.lock() {
            Ok(cache) => cache,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn reserve_sports_requests(&self, request_count: usize) -> Result<(), ProviderError> {
        let mut reservations = match self.sports_request_times.lock() {
            Ok(reservations) => reservations,
            Err(poisoned) => poisoned.into_inner(),
        };
        reserve_sports_request_budget(&mut reservations, Instant::now(), request_count)
    }

    fn google_oauth_attempt_lock(&self) -> MutexGuard<'_, Option<GoogleOAuthAttempt>> {
        match self.google_oauth_attempt.lock() {
            Ok(attempt) => attempt,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn clear_google_oauth_attempt(&self) {
        if let Some(attempt) = self.google_oauth_attempt_lock().take() {
            cancel_google_oauth_attempt(attempt);
        }
    }
}

fn cancel_google_oauth_attempt(attempt: GoogleOAuthAttempt) {
    // A loopback listener exists only for this native attempt. Signaling is
    // best-effort because it may already have returned a callback result.
    let _ = attempt.cancellation_sender.try_send(());
}

fn google_oauth_client_id() -> Result<&'static str, ProviderError> {
    match GOOGLE_OAUTH_CLIENT_ID {
        Some(value) if is_valid_google_client_id(value) => Ok(value),
        _ => Err(ProviderError::Unavailable {
            provider: "Google Calendar",
            message: "Google Calendar OAuth is not configured in this build. Set AMBIENT_GOOGLE_CLIENT_ID at native build time."
                .to_owned(),
            retryable: false,
        }),
    }
}

fn stale_google_calendar_response(events: Vec<GoogleCalendarEvent>) -> GoogleCalendarTodayResponse {
    GoogleCalendarTodayResponse {
        events,
        stale: true,
        message: "Google Calendar is unavailable; showing this session’s cached events.".to_owned(),
    }
}

fn is_valid_google_client_id(value: &str) -> bool {
    let value = value.as_bytes();
    !value.is_empty() && value.len() <= 512 && value.iter().all(|byte| byte.is_ascii_graphic())
}

fn random_urlsafe_value(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn google_authorization_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    code_challenge: &str,
) -> Result<Url, ProviderError> {
    let mut url =
        Url::parse(GOOGLE_OAUTH_AUTHORIZE_URL).map_err(|_| ProviderError::Unavailable {
            provider: "Google Calendar",
            message: "Google Calendar OAuth endpoint configuration is invalid.".to_owned(),
            retryable: false,
        })?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", GOOGLE_CALENDAR_SCOPE)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", state)
        .append_pair("code_challenge", code_challenge)
        .append_pair("code_challenge_method", "S256");
    Ok(url)
}

fn receive_google_oauth_callback(
    listener: TcpListener,
    expected_state: &str,
    cancellation_receiver: Receiver<()>,
) -> Result<GoogleOAuthCallback, ProviderError> {
    let deadline = Instant::now() + GOOGLE_OAUTH_CALLBACK_TIMEOUT;
    loop {
        match cancellation_receiver.try_recv() {
            Ok(()) | Err(TryRecvError::Disconnected) => {
                return Err(ProviderError::Unavailable {
                    provider: "Google Calendar",
                    message: "Google Calendar authorization was cancelled.".to_owned(),
                    retryable: false,
                });
            }
            Err(TryRecvError::Empty) => {}
        }
        match listener.accept() {
            Ok((mut stream, address)) => {
                if !address.ip().is_loopback() {
                    write_google_oauth_callback_page(&mut stream, false);
                    continue;
                }
                let callback_result = parse_google_oauth_callback(&mut stream, expected_state);
                let succeeded = matches!(&callback_result, Ok(Some(_)));
                write_google_oauth_callback_page(&mut stream, succeeded);
                match callback_result {
                    Ok(Some(callback)) => return Ok(callback),
                    // Ignore unsolicited/malformed callbacks rather than
                    // letting another local process consume a valid attempt.
                    Ok(None) => continue,
                    Err(error) => return Err(error),
                }
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(ProviderError::Unavailable {
                        provider: "Google Calendar",
                        message:
                            "Google Calendar authorization timed out. Start the connection again."
                                .to_owned(),
                        retryable: true,
                    });
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(_) => {
                return Err(ProviderError::Unavailable {
                    provider: "Google Calendar",
                    message: "Google Calendar authorization callback stopped unexpectedly. Start it again."
                        .to_owned(),
                    retryable: true,
                });
            }
        }
    }
}

fn parse_google_oauth_callback(
    stream: &mut TcpStream,
    expected_state: &str,
) -> Result<Option<GoogleOAuthCallback>, ProviderError> {
    // Any local process can connect to a loopback port. Treat malformed or
    // slow unsolicited requests as ignorable noise rather than letting them
    // cancel the real browser authorization attempt.
    if stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .is_err()
    {
        return Ok(None);
    }
    let Ok(request) = read_loopback_http_request(stream) else {
        return Ok(None);
    };
    let request_line = request.lines().next().unwrap_or_default();
    let mut fields = request_line.split_whitespace();
    if fields.next() != Some("GET") {
        return Ok(None);
    }
    let Some(target) = fields.next() else {
        return Ok(None);
    };
    if !target.starts_with('/') || target.len() > 4_096 {
        return Ok(None);
    }
    let callback_url = Url::parse(&format!("http://127.0.0.1{target}")).ok();
    let Some(callback_url) = callback_url else {
        return Ok(None);
    };
    if callback_url.path() != GOOGLE_OAUTH_CALLBACK_PATH {
        return Ok(None);
    }

    let mut code = None;
    let mut state = None;
    let mut denied = false;
    for (name, value) in callback_url.query_pairs() {
        match name.as_ref() {
            "code" if code.is_none() => code = Some(value.into_owned()),
            "state" if state.is_none() => state = Some(value.into_owned()),
            "error" => denied = true,
            "code" | "state" => return Ok(None),
            _ => {}
        }
    }

    if state.as_deref() != Some(expected_state) {
        return Ok(None);
    }
    if denied {
        return Err(ProviderError::Unavailable {
            provider: "Google Calendar",
            message: "Google Calendar authorization was not granted. Start the connection again."
                .to_owned(),
            retryable: false,
        });
    }
    let Some(code) = code.filter(|value| is_valid_google_token_value(value)) else {
        return Err(ProviderError::Unavailable {
            provider: "Google Calendar",
            message: "Google Calendar returned an invalid authorization callback. Start the connection again."
                .to_owned(),
            retryable: true,
        });
    };
    Ok(Some(GoogleOAuthCallback { code }))
}

fn read_loopback_http_request(stream: &mut TcpStream) -> Result<String, ProviderError> {
    const MAX_LOOPBACK_REQUEST_BYTES: usize = 8 * 1024;
    let mut request = Vec::with_capacity(1_024);
    let mut buffer = [0_u8; 1_024];
    while request.len() < MAX_LOOPBACK_REQUEST_BYTES {
        let read = stream
            .read(&mut buffer)
            .map_err(|_| provider_temporarily_unavailable("Google Calendar"))?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    if request.len() >= MAX_LOOPBACK_REQUEST_BYTES {
        return Err(ProviderError::Unavailable {
            provider: "Google Calendar",
            message:
                "Google Calendar authorization callback was too large. Start the connection again."
                    .to_owned(),
            retryable: true,
        });
    }
    if !request.windows(4).any(|window| window == b"\r\n\r\n") {
        return Err(ProviderError::Unavailable {
            provider: "Google Calendar",
            message:
                "Google Calendar authorization callback was incomplete. Start the connection again."
                    .to_owned(),
            retryable: true,
        });
    }
    String::from_utf8(request).map_err(|_| ProviderError::Unavailable {
        provider: "Google Calendar",
        message: "Google Calendar authorization callback was invalid. Start the connection again."
            .to_owned(),
        retryable: true,
    })
}

fn write_google_oauth_callback_page(stream: &mut TcpStream, succeeded: bool) {
    let (status, body) = if succeeded {
        (
            "200 OK",
            "Google Calendar is connected. You can close this browser tab and return to Ambient Glass.",
        )
    } else {
        (
            "400 Bad Request",
            "Google Calendar authorization was not completed. Return to Ambient Glass and try again.",
        )
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn google_oauth_http_error(status: StatusCode) -> ProviderError {
    if matches!(
        status,
        StatusCode::BAD_REQUEST | StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) {
        return ProviderError::Unavailable {
            provider: "Google Calendar",
            message:
                "Google Calendar authorization was rejected or expired. Reconnect it in settings."
                    .to_owned(),
            retryable: false,
        };
    }
    provider_http_error("Google Calendar", status)
}

fn is_valid_google_token_value(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty() && bytes.len() <= 4 * 1024 && bytes.iter().all(|byte| byte.is_ascii_graphic())
}

fn google_day_bounds(local_day: &str) -> Result<(String, String), ProviderError> {
    let day = NaiveDate::parse_from_str(local_day, "%Y-%m-%d").map_err(|_| {
        ProviderError::Validation {
            field: "localDay",
            message: "Use a local day in YYYY-MM-DD format.".to_owned(),
        }
    })?;
    let next_day = day
        .checked_add_days(Days::new(1))
        .ok_or_else(|| ProviderError::Validation {
            field: "localDay",
            message: "Use a local day in YYYY-MM-DD format.".to_owned(),
        })?;
    Ok((
        first_google_local_instant(day)?.to_rfc3339(),
        first_google_local_instant(next_day)?.to_rfc3339(),
    ))
}

fn first_google_local_instant(day: NaiveDate) -> Result<DateTime<Local>, ProviderError> {
    for hour in 0..24 {
        match Local.with_ymd_and_hms(day.year(), day.month(), day.day(), hour, 0, 0) {
            LocalResult::Single(value) => return Ok(value),
            LocalResult::Ambiguous(first, _) => return Ok(first),
            LocalResult::None => {}
        }
    }
    Err(ProviderError::Unavailable {
        provider: "Google Calendar",
        message: "Could not determine local-day boundaries for Google Calendar.".to_owned(),
        retryable: false,
    })
}

fn google_calendar_create_payload(
    request: GoogleCalendarEventCreateRequest,
) -> Result<GoogleCalendarCreatePayload, ProviderError> {
    let title =
        normalized_text(Some(request.title), MAX_GOOGLE_EVENT_TITLE_CHARS).ok_or_else(|| {
            ProviderError::Validation {
                field: "title",
                message:
                    "Google Calendar event titles must be non-empty and at most 256 characters."
                        .to_owned(),
            }
        })?;

    if request.all_day {
        let start = parse_google_calendar_date(&request.starts_at, "startsAt")?;
        let end =
            match request.ends_at {
                Some(value) => parse_google_calendar_date(&value, "endsAt")?,
                None => start.checked_add_days(Days::new(1)).ok_or_else(|| {
                    ProviderError::Validation {
                        field: "startsAt",
                        message: "Google Calendar event date is out of range.".to_owned(),
                    }
                })?,
            };
        if end <= start {
            return Err(ProviderError::Validation {
                field: "endsAt",
                message: "Google Calendar all-day events must end after they start.".to_owned(),
            });
        }
        if end.signed_duration_since(start) > ChronoDuration::days(MAX_GOOGLE_EVENT_DURATION_DAYS) {
            return Err(ProviderError::Validation {
                field: "endsAt",
                message: "Google Calendar events may not exceed 31 days.".to_owned(),
            });
        }
        return Ok(GoogleCalendarCreatePayload {
            summary: title,
            start: GoogleCalendarWriteTime::all_day(start),
            end: GoogleCalendarWriteTime::all_day(end),
        });
    }

    let start = parse_google_calendar_datetime(&request.starts_at, "startsAt")?;
    let end = match request.ends_at {
        Some(value) => parse_google_calendar_datetime(&value, "endsAt")?,
        None => start + ChronoDuration::minutes(30),
    };
    let duration = end.signed_duration_since(start);
    if duration <= ChronoDuration::zero() {
        return Err(ProviderError::Validation {
            field: "endsAt",
            message: "Google Calendar events must end after they start.".to_owned(),
        });
    }
    if duration > ChronoDuration::days(MAX_GOOGLE_EVENT_DURATION_DAYS) {
        return Err(ProviderError::Validation {
            field: "endsAt",
            message: "Google Calendar events may not exceed 31 days.".to_owned(),
        });
    }
    Ok(GoogleCalendarCreatePayload {
        summary: title,
        start: GoogleCalendarWriteTime::timed(start),
        end: GoogleCalendarWriteTime::timed(end),
    })
}

fn parse_google_calendar_date(
    value: &str,
    field: &'static str,
) -> Result<NaiveDate, ProviderError> {
    let bytes = value.as_bytes();
    let valid_shape = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());
    if !valid_shape || !is_real_calendar_day(bytes) {
        return Err(ProviderError::Validation {
            field,
            message: "Use an all-day Google Calendar date in YYYY-MM-DD format.".to_owned(),
        });
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| ProviderError::Validation {
        field,
        message: "Use an all-day Google Calendar date in YYYY-MM-DD format.".to_owned(),
    })
}

fn parse_google_calendar_datetime(
    value: &str,
    field: &'static str,
) -> Result<DateTime<chrono::FixedOffset>, ProviderError> {
    DateTime::parse_from_rfc3339(value).map_err(|_| ProviderError::Validation {
        field,
        message: "Use a Google Calendar time with an RFC3339 UTC offset.".to_owned(),
    })
}

fn mock_github_commits(local_day: Option<String>) -> GithubCommitsResponse {
    GithubCommitsResponse {
        label: "Commits counted by GitHub".to_owned(),
        count: 4,
        commits: 4,
        local_day,
        mode: ProviderMode::Mock,
        stale: false,
        message: "Showing deterministic mock GitHub data; no token is configured.".to_owned(),
    }
}

fn mock_sports_response() -> SportsRefreshResponse {
    SportsRefreshResponse {
        mode: ProviderMode::Mock,
        events: vec![
            SportsEvent {
                id: "mock-live-1".to_owned(),
                sport: "Basketball".to_owned(),
                league_id: Some("4387".to_owned()),
                league: "NBA".to_owned(),
                start_time: "2026-05-11T19:20:00Z".to_owned(),
                home_team_id: Some("133600".to_owned()),
                home_name: "Golden State".to_owned(),
                away_team_id: Some("134860".to_owned()),
                away_name: "Phoenix".to_owned(),
                home_badge_url: None,
                away_badge_url: None,
                home_score: Some(67),
                away_score: Some(64),
                status: SportsEventStatus::Live,
                clock_or_period: Some("Q3".to_owned()),
            },
            SportsEvent {
                id: "mock-upcoming-1".to_owned(),
                sport: "Baseball".to_owned(),
                league_id: Some("4424".to_owned()),
                league: "MLB".to_owned(),
                start_time: "2026-05-11T19:10:00Z".to_owned(),
                home_team_id: Some("135254".to_owned()),
                home_name: "San Francisco".to_owned(),
                away_team_id: Some("135267".to_owned()),
                away_name: "Los Angeles".to_owned(),
                home_badge_url: None,
                away_badge_url: None,
                home_score: None,
                away_score: None,
                status: SportsEventStatus::Scheduled,
                clock_or_period: None,
            },
        ],
        stale: false,
        message: "Showing deterministic mock sports data; no provider request was sent.".to_owned(),
    }
}

fn secret_validation_error(
    slot: ProviderSecretSlot,
    error: SecretValidationError,
) -> ProviderError {
    ProviderError::Validation {
        field: "value",
        message: error.message(slot).to_owned(),
    }
}

fn secure_storage_error(_: CredentialStoreError) -> ProviderError {
    ProviderError::SecureStorage {
        message: "Secure credential storage is unavailable. Check the operating system keychain and try again."
            .to_owned(),
    }
}

fn provider_temporarily_unavailable(provider: &'static str) -> ProviderError {
    ProviderError::Unavailable {
        provider,
        message: format!("{provider} is temporarily unavailable. Try again shortly."),
        retryable: true,
    }
}

fn provider_http_error(provider: &'static str, status: StatusCode) -> ProviderError {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return ProviderError::Unavailable {
            provider,
            message: format!(
                "The saved {provider} credential was rejected. Update it in settings."
            ),
            retryable: false,
        };
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return ProviderError::Unavailable {
            provider,
            message: format!(
                "{provider} is rate-limiting requests. Cached data will be used when available."
            ),
            retryable: true,
        };
    }
    provider_temporarily_unavailable(provider)
}

fn response_exceeds_limit(content_length: Option<&reqwest::header::HeaderValue>) -> bool {
    content_length
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|size| size > MAX_PROVIDER_RESPONSE_BYTES)
}

/// Read a provider response incrementally so an absent, compressed, or
/// misleading Content-Length header cannot make the desktop process buffer an
/// unbounded body before JSON deserialization.
async fn parse_bounded_json<T: DeserializeOwned>(
    response: reqwest::Response,
    provider: &'static str,
) -> Result<T, ProviderError> {
    if response_exceeds_limit(response.headers().get(CONTENT_LENGTH)) {
        return Err(provider_temporarily_unavailable(provider));
    }

    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| provider_temporarily_unavailable(provider))?;
        if body.len().saturating_add(chunk.len()) > MAX_PROVIDER_RESPONSE_BYTES as usize {
            return Err(provider_temporarily_unavailable(provider));
        }
        body.extend_from_slice(&chunk);
    }

    serde_json::from_slice(&body).map_err(|_| provider_temporarily_unavailable(provider))
}

fn validate_local_day(value: &str) -> Result<String, ProviderError> {
    // Date input is intentionally narrow because it becomes a GraphQL variable.
    let bytes = value.as_bytes();
    let valid_shape = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit());
    if !valid_shape || !is_real_calendar_day(bytes) {
        return Err(ProviderError::Validation {
            field: "localDay",
            message: "Use a local day in YYYY-MM-DD format.".to_owned(),
        });
    }
    Ok(value.to_owned())
}

fn validate_favorite_team_ids(values: Option<Vec<String>>) -> Result<Vec<String>, ProviderError> {
    let values = values.unwrap_or_default();
    if values.len() > MAX_FAVORITE_SPORTS_TEAMS {
        return Err(ProviderError::Validation {
            field: "favoriteTeamIds",
            message: format!(
                "Choose no more than {MAX_FAVORITE_SPORTS_TEAMS} favorite sports teams."
            ),
        });
    }

    let mut normalized = Vec::with_capacity(values.len());
    let mut seen = HashSet::with_capacity(values.len());
    for value in values {
        if value.is_empty() || value.len() > 32 || !value.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(ProviderError::Validation {
                field: "favoriteTeamIds",
                message: "Sports team IDs must contain digits only.".to_owned(),
            });
        }
        if seen.insert(value.clone()) {
            normalized.push(value);
        }
    }
    Ok(normalized)
}

fn sports_cache_key(local_day: &str, favorite_team_ids: &[String]) -> String {
    let mut team_ids = favorite_team_ids.to_vec();
    team_ids.sort();
    format!("{local_day}:{}", team_ids.join(","))
}

fn sports_refresh_request_count(favorite_team_count: usize) -> usize {
    1usize.saturating_add(favorite_team_count.saturating_mul(2))
}

fn reserve_sports_request_budget(
    reservations: &mut VecDeque<Instant>,
    now: Instant,
    request_count: usize,
) -> Result<(), ProviderError> {
    while reservations.front().is_some_and(|reserved_at| {
        now.saturating_duration_since(*reserved_at) >= SPORTS_PROVIDER_REQUEST_WINDOW
    }) {
        reservations.pop_front();
    }

    if request_count > SPORTS_PROVIDER_REQUEST_BUDGET
        || reservations.len().saturating_add(request_count) > SPORTS_PROVIDER_REQUEST_BUDGET
    {
        return Err(ProviderError::Unavailable {
            provider: "TheSportsDB",
            message: "Sports refresh is cooling down to stay within the provider request limit. Try again in about a minute."
                .to_owned(),
            retryable: true,
        });
    }

    reservations.extend(std::iter::repeat(now).take(request_count));
    Ok(())
}

fn today_in_local_timezone() -> String {
    Local::now().date_naive().format("%Y-%m-%d").to_string()
}

fn github_day_bounds(local_day: &str) -> Result<(String, String), ProviderError> {
    let day = NaiveDate::parse_from_str(local_day, "%Y-%m-%d").map_err(|_| {
        ProviderError::Validation {
            field: "localDay",
            message: "Use a local day in YYYY-MM-DD format.".to_owned(),
        }
    })?;
    let next_day = day
        .checked_add_days(Days::new(1))
        .ok_or_else(|| ProviderError::Validation {
            field: "localDay",
            message: "Use a local day in YYYY-MM-DD format.".to_owned(),
        })?;
    Ok((
        first_local_instant(day)?.to_rfc3339(),
        first_local_instant(next_day)?.to_rfc3339(),
    ))
}

/// Some time zones have a DST transition at midnight. For that unusual case,
/// use the first real local hour instead of inventing a UTC boundary.
fn first_local_instant(day: NaiveDate) -> Result<DateTime<Local>, ProviderError> {
    for hour in 0..24 {
        match Local.with_ymd_and_hms(day.year(), day.month(), day.day(), hour, 0, 0) {
            LocalResult::Single(value) => return Ok(value),
            LocalResult::Ambiguous(first, _) => return Ok(first),
            LocalResult::None => {}
        }
    }
    Err(ProviderError::Unavailable {
        provider: "GitHub",
        message: "Could not determine local-day boundaries for GitHub.".to_owned(),
        retryable: false,
    })
}

fn is_real_calendar_day(value: &[u8]) -> bool {
    let year = parse_number(&value[0..4]);
    let month = parse_number(&value[5..7]);
    let day = parse_number(&value[8..10]);
    if year == 0 || !(1..=12).contains(&month) || day == 0 {
        return false;
    }

    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => return false,
    };
    day <= days_in_month
}

fn parse_number(value: &[u8]) -> u16 {
    value
        .iter()
        .fold(0, |number, digit| number * 10 + u16::from(*digit - b'0'))
}

fn is_leap_year(year: u16) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn validate_transcription_request(request: &TranscriptionRequest) -> Result<(), ProviderError> {
    if !request.explicit_push_to_talk {
        return Err(ProviderError::Validation {
            field: "explicitPushToTalk",
            message: "Voice capture is accepted only after explicit push-to-talk.".to_owned(),
        });
    }
    if request.audio.is_empty() || request.audio.len() > MAX_TRANSCRIPTION_BYTES {
        return Err(ProviderError::Validation {
            field: "audio",
            message: "Voice capture must be between 1 byte and 10 MiB.".to_owned(),
        });
    }
    if request.duration_ms == 0 || request.duration_ms > MAX_TRANSCRIPTION_DURATION_MS {
        return Err(ProviderError::Validation {
            field: "durationMs",
            message: "Voice capture must be at most 60 seconds.".to_owned(),
        });
    }
    if !matches!(
        request.mime_type.as_str(),
        "audio/webm" | "audio/webm;codecs=opus" | "audio/wav" | "audio/ogg" | "audio/mp4"
    ) {
        return Err(ProviderError::Validation {
            field: "mimeType",
            message: "Voice capture must be WebM, WAV, OGG, or MP4 audio.".to_owned(),
        });
    }
    Ok(())
}

fn audio_extension(mime_type: &str) -> &'static str {
    match mime_type {
        "audio/wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/mp4" => "m4a",
        "audio/webm" | "audio/webm;codecs=opus" => "webm",
        _ => "audio",
    }
}

#[derive(Serialize)]
struct GithubGraphqlRequest<'a> {
    query: &'a str,
    variables: GithubGraphqlVariables,
}

#[derive(Serialize)]
struct GithubGraphqlVariables {
    from: String,
    to: String,
}

#[derive(Deserialize)]
struct GithubGraphqlEnvelope {
    data: Option<GithubGraphqlData>,
    errors: Option<Vec<Value>>,
}

#[derive(Deserialize)]
struct GithubGraphqlData {
    viewer: Option<GithubViewer>,
}

#[derive(Deserialize)]
struct GithubViewer {
    #[serde(rename = "contributionsCollection")]
    contributions_collection: GithubContributionsCollection,
}

#[derive(Deserialize)]
struct GithubContributionsCollection {
    #[serde(rename = "totalCommitContributions")]
    total_commit_contributions: u32,
}

#[derive(Deserialize)]
struct TheSportsDbEventsResponse {
    events: Option<Vec<TheSportsDbEvent>>,
}

#[derive(Deserialize)]
struct TheSportsDbEvent {
    #[serde(rename = "idEvent")]
    id: Option<String>,
    #[serde(rename = "strSport")]
    sport: Option<String>,
    #[serde(rename = "idLeague")]
    league_id: Option<String>,
    #[serde(rename = "strLeague")]
    league: Option<String>,
    #[serde(rename = "dateEvent")]
    date: Option<String>,
    #[serde(rename = "strTime")]
    time: Option<String>,
    #[serde(rename = "strTimestamp")]
    timestamp: Option<String>,
    #[serde(rename = "idHomeTeam")]
    home_team_id: Option<String>,
    #[serde(rename = "strHomeTeam")]
    home_name: Option<String>,
    #[serde(rename = "idAwayTeam")]
    away_team_id: Option<String>,
    #[serde(rename = "strAwayTeam")]
    away_name: Option<String>,
    #[serde(rename = "strHomeTeamBadge")]
    home_badge_url: Option<String>,
    #[serde(rename = "strAwayTeamBadge")]
    away_badge_url: Option<String>,
    #[serde(rename = "intHomeScore")]
    home_score: Option<Value>,
    #[serde(rename = "intAwayScore")]
    away_score: Option<Value>,
    #[serde(rename = "strStatus")]
    status: Option<String>,
    #[serde(rename = "strProgress")]
    progress: Option<String>,
    #[serde(rename = "strPostponed")]
    postponed: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiTranscriptionResponse {
    text: Option<String>,
}

#[derive(Deserialize)]
struct GoogleOAuthTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct GoogleCalendarEventsResponse {
    items: Option<Vec<GoogleCalendarApiEvent>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarApiEvent {
    id: Option<String>,
    summary: Option<String>,
    start: Option<GoogleCalendarApiTime>,
    end: Option<GoogleCalendarApiTime>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarApiTime {
    date_time: Option<String>,
    date: Option<String>,
}

#[derive(Serialize)]
struct GoogleCalendarCreatePayload {
    summary: String,
    start: GoogleCalendarWriteTime,
    end: GoogleCalendarWriteTime,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleCalendarWriteTime {
    #[serde(skip_serializing_if = "Option::is_none")]
    date_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    date: Option<String>,
}

impl GoogleCalendarWriteTime {
    fn timed(value: DateTime<chrono::FixedOffset>) -> Self {
        Self {
            date_time: Some(value.to_rfc3339()),
            date: None,
        }
    }

    fn all_day(value: NaiveDate) -> Self {
        Self {
            date_time: None,
            date: Some(value.format("%Y-%m-%d").to_string()),
        }
    }
}

fn normalize_sports_event(event: TheSportsDbEvent) -> Option<SportsEvent> {
    let id = normalized_text(event.id, 128)?;
    let sport = normalized_text(event.sport, 96)?;
    let league_id = normalized_provider_id(event.league_id);
    let league = normalized_text(event.league, 128)?;
    let home_team_id = normalized_provider_id(event.home_team_id);
    let home_name = normalized_text(event.home_name, 128)?;
    let away_team_id = normalized_provider_id(event.away_team_id);
    let away_name = normalized_text(event.away_name, 128)?;
    let start_time = normalized_start_time(event.timestamp, event.date, event.time)?;
    let source_status = normalized_text(event.status, 96).unwrap_or_default();
    let progress = normalized_text(event.progress, 96);
    let postponed = normalized_text(event.postponed, 16)
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "yes" | "true" | "1"));
    let status = normalized_event_status(&source_status, progress.as_deref(), postponed);
    let clock_or_period = normalized_clock_or_period(status, &source_status, progress);

    Some(SportsEvent {
        id,
        sport,
        league_id,
        league,
        start_time,
        home_team_id,
        home_name,
        away_team_id,
        away_name,
        home_badge_url: safe_https_url(event.home_badge_url),
        away_badge_url: safe_https_url(event.away_badge_url),
        home_score: normalized_score(event.home_score),
        away_score: normalized_score(event.away_score),
        status,
        clock_or_period,
    })
}

fn merge_sports_event(
    events: &mut Vec<SportsEvent>,
    indexes: &mut HashMap<String, usize>,
    event: SportsEvent,
) {
    if let Some(index) = indexes.get(&event.id).copied() {
        if sports_event_detail_score(&event) > sports_event_detail_score(&events[index]) {
            events[index] = event;
        }
        return;
    }
    indexes.insert(event.id.clone(), events.len());
    events.push(event);
}

fn sports_event_has_team(event: &SportsEvent, team_id: &str) -> bool {
    event.home_team_id.as_deref() == Some(team_id) || event.away_team_id.as_deref() == Some(team_id)
}

fn sports_event_detail_score(event: &SportsEvent) -> u16 {
    let status = match event.status {
        SportsEventStatus::Scheduled => 1,
        SportsEventStatus::Postponed | SportsEventStatus::Cancelled => 2,
        SportsEventStatus::Live => 3,
        SportsEventStatus::Final => 4,
    };
    status * 16
        + u16::from(event.home_score.is_some())
        + u16::from(event.away_score.is_some())
        + u16::from(event.clock_or_period.is_some())
        + u16::from(event.home_team_id.is_some())
        + u16::from(event.away_team_id.is_some())
        + u16::from(event.league_id.is_some())
}

fn normalize_google_calendar_event(event: GoogleCalendarApiEvent) -> Option<GoogleCalendarEvent> {
    let external_id = normalized_text(event.id, 256)?;
    let title = normalized_text(event.summary, MAX_GOOGLE_EVENT_TITLE_CHARS)
        .unwrap_or_else(|| "Untitled event".to_owned());
    let start = event.start?;

    if let Some(date_time) = normalized_text(start.date_time, 96) {
        let start = DateTime::parse_from_rfc3339(&date_time).ok()?;
        let ends_at = event
            .end
            .and_then(|end| normalized_text(end.date_time, 96))
            .and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
            .filter(|end| end > &start)
            .map(|end| end.to_rfc3339());
        return Some(GoogleCalendarEvent {
            id: format!("google:{external_id}"),
            title,
            starts_at: start.to_rfc3339(),
            ends_at,
            all_day: false,
            source: "google".to_owned(),
            external_id: Some(external_id),
        });
    }

    let date = normalized_text(start.date, 16)?;
    let starts_at = NaiveDate::parse_from_str(&date, "%Y-%m-%d").ok()?;
    let ends_at = event
        .end
        .and_then(|end| normalized_text(end.date, 16))
        .and_then(|value| NaiveDate::parse_from_str(&value, "%Y-%m-%d").ok())
        .filter(|end| end > &starts_at)
        .map(|end| end.format("%Y-%m-%d").to_string());
    Some(GoogleCalendarEvent {
        id: format!("google:{external_id}"),
        title,
        starts_at: starts_at.format("%Y-%m-%d").to_string(),
        ends_at,
        all_day: true,
        source: "google".to_owned(),
        external_id: Some(external_id),
    })
}

fn normalized_text(value: Option<String>, max_chars: usize) -> Option<String> {
    let value = value?.trim().to_owned();
    if value.is_empty() || value.chars().count() > max_chars || value.chars().any(char::is_control)
    {
        return None;
    }
    Some(value)
}

fn normalized_provider_id(value: Option<String>) -> Option<String> {
    let value = normalized_text(value, 32)?;
    value
        .bytes()
        .all(|byte| byte.is_ascii_digit())
        .then_some(value)
}

fn normalized_start_time(
    timestamp: Option<String>,
    date: Option<String>,
    time: Option<String>,
) -> Option<String> {
    if let Some(timestamp) = normalized_text(timestamp, 96) {
        if let Ok(parsed) = DateTime::parse_from_rfc3339(&timestamp) {
            return Some(parsed.to_rfc3339());
        }
        if let Ok(parsed) = NaiveDateTime::parse_from_str(&timestamp, "%Y-%m-%dT%H:%M:%S") {
            return Some(format!("{}Z", parsed.format("%Y-%m-%dT%H:%M:%S")));
        }
    }

    let date = normalized_text(date, 16)?;
    let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").ok()?;
    if let Some(time) = normalized_text(time, 16) {
        let time = NaiveTime::parse_from_str(&time, "%H:%M:%S")
            .or_else(|_| NaiveTime::parse_from_str(&time, "%H:%M"))
            .ok()?;
        return Some(format!(
            "{}T{}Z",
            date.format("%Y-%m-%d"),
            time.format("%H:%M:%S")
        ));
    }
    Some(format!("{}T00:00:00Z", date.format("%Y-%m-%d")))
}

fn normalized_score(value: Option<Value>) -> Option<u32> {
    let score = match value? {
        Value::Number(number) => number.as_u64(),
        Value::String(value) => value.trim().parse::<u64>().ok(),
        _ => None,
    }?;
    u32::try_from(score).ok().filter(|score| *score <= 9_999)
}

fn safe_https_url(value: Option<String>) -> Option<String> {
    let value = normalized_text(value, 2_048)?;
    let parsed = Url::parse(&value).ok()?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    Some(value)
}

fn normalized_event_status(
    status: &str,
    progress: Option<&str>,
    postponed: bool,
) -> SportsEventStatus {
    let status = status.to_ascii_lowercase();
    let progress = progress.unwrap_or_default().to_ascii_lowercase();
    let combined = format!("{status} {progress}");

    if postponed || combined.contains("postpon") {
        SportsEventStatus::Postponed
    } else if combined.contains("cancel") {
        SportsEventStatus::Cancelled
    } else if combined.contains("finished")
        || combined.contains("final")
        || combined.trim() == "ft"
        || combined.contains("match ended")
    {
        SportsEventStatus::Final
    } else if !progress.trim().is_empty() && progress.trim() != "0"
        || combined.contains("live")
        || combined.contains("in progress")
        || combined.contains("half time")
        || combined.contains("halftime")
        || combined.contains("quarter")
    {
        SportsEventStatus::Live
    } else {
        SportsEventStatus::Scheduled
    }
}

fn normalized_clock_or_period(
    status: SportsEventStatus,
    source_status: &str,
    progress: Option<String>,
) -> Option<String> {
    match status {
        SportsEventStatus::Scheduled => None,
        SportsEventStatus::Final => Some("Final".to_owned()),
        SportsEventStatus::Postponed => Some("Postponed".to_owned()),
        SportsEventStatus::Cancelled => Some("Cancelled".to_owned()),
        SportsEventStatus::Live => progress
            .filter(|value| value != "0")
            .or_else(|| normalized_text(Some(source_status.to_owned()), 96))
            .or_else(|| Some("Live".to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        google_authorization_url, google_calendar_create_payload, normalize_google_calendar_event,
        normalize_sports_event, reserve_sports_request_budget, safe_https_url, sports_cache_key,
        sports_refresh_request_count, validate_favorite_team_ids, validate_local_day,
        GoogleCalendarApiEvent, GoogleCalendarApiTime, GoogleCalendarEventCreateRequest,
        ProviderError, SportsEventStatus, TheSportsDbEvent, GOOGLE_CALENDAR_SCOPE,
        SPORTS_PROVIDER_REQUEST_BUDGET, SPORTS_PROVIDER_REQUEST_WINDOW,
    };
    use serde_json::json;
    use std::{collections::VecDeque, time::Instant};

    #[test]
    fn local_day_validation_checks_calendar_boundaries() {
        assert!(validate_local_day("2028-02-29").is_ok());
        assert!(validate_local_day("2027-02-29").is_err());
        assert!(validate_local_day("2027-13-01").is_err());
        assert!(validate_local_day("2027-01-00").is_err());
    }

    #[test]
    fn sports_payload_is_normalized_and_untrusted_badges_are_dropped() {
        let event = TheSportsDbEvent {
            id: Some("fixture-1".to_owned()),
            sport: Some("Basketball".to_owned()),
            league_id: Some("4387".to_owned()),
            league: Some("NBA".to_owned()),
            date: Some("2026-05-11".to_owned()),
            time: Some("19:20:00".to_owned()),
            timestamp: None,
            home_team_id: Some("133600".to_owned()),
            home_name: Some("Warriors".to_owned()),
            away_team_id: Some("134860".to_owned()),
            away_name: Some("Lakers".to_owned()),
            home_badge_url: Some("javascript:alert(1)".to_owned()),
            away_badge_url: Some("https://images.example.test/lakers.png".to_owned()),
            home_score: Some(json!(108)),
            away_score: Some(json!(112)),
            status: Some("In Progress".to_owned()),
            progress: Some("Q4 · 02:34".to_owned()),
            postponed: None,
        };

        let normalized = normalize_sports_event(event).expect("valid provider fixture");
        assert_eq!(normalized.status, SportsEventStatus::Live);
        assert_eq!(normalized.start_time, "2026-05-11T19:20:00Z");
        assert_eq!(normalized.league_id.as_deref(), Some("4387"));
        assert_eq!(normalized.home_team_id.as_deref(), Some("133600"));
        assert_eq!(normalized.away_team_id.as_deref(), Some("134860"));
        assert_eq!(normalized.home_badge_url, None);
        assert_eq!(
            normalized.away_badge_url.as_deref(),
            Some("https://images.example.test/lakers.png")
        );
    }

    #[test]
    fn favorite_team_ids_are_bounded_numeric_and_cache_order_independent() {
        let ids = validate_favorite_team_ids(Some(vec![
            "134860".to_owned(),
            "133600".to_owned(),
            "134860".to_owned(),
        ]))
        .expect("numeric team IDs should validate");
        assert_eq!(ids, vec!["134860", "133600"]);
        assert_eq!(
            sports_cache_key("2026-07-12", &ids),
            sports_cache_key("2026-07-12", &["133600".to_owned(), "134860".to_owned()])
        );
        assert!(validate_favorite_team_ids(Some(vec!["team/unsafe".to_owned()])).is_err());
        assert!(validate_favorite_team_ids(Some(
            (0..9).map(|index| format!("13{index:04}")).collect()
        ))
        .is_err());
    }

    #[test]
    fn sports_request_budget_reserves_a_whole_refresh_and_recovers_after_window() {
        let now = Instant::now();
        let mut reservations = VecDeque::new();
        let maximum_refresh = sports_refresh_request_count(8);
        assert_eq!(maximum_refresh, 17);

        reserve_sports_request_budget(&mut reservations, now, maximum_refresh)
            .expect("one maximum-size refresh should fit");
        reserve_sports_request_budget(
            &mut reservations,
            now,
            SPORTS_PROVIDER_REQUEST_BUDGET - maximum_refresh,
        )
        .expect("the remaining conservative allowance should fit");
        assert!(matches!(
            reserve_sports_request_budget(&mut reservations, now, 1),
            Err(ProviderError::Unavailable {
                provider: "TheSportsDB",
                retryable: true,
                ..
            })
        ));

        let after_window = now + SPORTS_PROVIDER_REQUEST_WINDOW;
        reserve_sports_request_budget(&mut reservations, after_window, maximum_refresh)
            .expect("expired reservations should release request credits");
        assert_eq!(reservations.len(), maximum_refresh);
    }

    #[test]
    fn sports_badge_urls_require_https_without_embedded_credentials() {
        assert_eq!(
            safe_https_url(Some("https://images.example.test/team.png".to_owned())).as_deref(),
            Some("https://images.example.test/team.png")
        );
        assert_eq!(
            safe_https_url(Some("http://images.example.test/team.png".to_owned())),
            None
        );
        assert_eq!(
            safe_https_url(Some(
                "https://user:password@images.example.test/team.png".to_owned()
            )),
            None
        );
    }

    #[test]
    fn google_authorization_url_uses_one_pkce_s256_parameter() {
        let url = google_authorization_url(
            "desktop-client-id.apps.googleusercontent.com",
            "http://127.0.0.1:53123/oauth2/callback",
            "state-value",
            "challenge-value",
        )
        .expect("fixed Google OAuth endpoint should parse");
        let pairs: Vec<(String, String)> = url
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        let values = |name: &str| -> Vec<&str> {
            pairs
                .iter()
                .filter_map(|(key, value)| (key.as_str() == name).then_some(value.as_str()))
                .collect()
        };

        assert_eq!(values("response_type"), vec!["code"]);
        assert_eq!(values("scope"), vec![GOOGLE_CALENDAR_SCOPE]);
        assert_eq!(
            values("redirect_uri"),
            vec!["http://127.0.0.1:53123/oauth2/callback"]
        );
        assert_eq!(values("code_challenge"), vec!["challenge-value"]);
        assert_eq!(values("code_challenge_method"), vec!["S256"]);
    }

    #[test]
    fn google_events_are_normalized_without_provider_payload_fields() {
        let timed = normalize_google_calendar_event(GoogleCalendarApiEvent {
            id: Some("google-event-1".to_owned()),
            summary: Some("Design review".to_owned()),
            start: Some(GoogleCalendarApiTime {
                date_time: Some("2026-07-09T09:00:00-07:00".to_owned()),
                date: None,
            }),
            end: Some(GoogleCalendarApiTime {
                date_time: Some("2026-07-09T09:30:00-07:00".to_owned()),
                date: None,
            }),
        })
        .expect("well-formed timed event should normalize");

        assert_eq!(timed.id, "google:google-event-1");
        assert_eq!(timed.external_id.as_deref(), Some("google-event-1"));
        assert_eq!(timed.starts_at, "2026-07-09T09:00:00-07:00");
        assert_eq!(timed.ends_at.as_deref(), Some("2026-07-09T09:30:00-07:00"));
        assert!(!timed.all_day);
        let serialized = serde_json::to_value(&timed).expect("display event should serialize");
        assert_eq!(serialized["source"], json!("google"));
        assert!(serialized.get("description").is_none());
        assert!(serialized.get("attendees").is_none());
        assert!(serialized.get("location").is_none());

        let all_day = normalize_google_calendar_event(GoogleCalendarApiEvent {
            id: Some("google-event-2".to_owned()),
            summary: None,
            start: Some(GoogleCalendarApiTime {
                date_time: None,
                date: Some("2026-07-10".to_owned()),
            }),
            end: Some(GoogleCalendarApiTime {
                date_time: None,
                date: Some("2026-07-11".to_owned()),
            }),
        })
        .expect("well-formed all-day event should normalize");
        assert_eq!(all_day.title, "Untitled event");
        assert_eq!(all_day.starts_at, "2026-07-10");
        assert_eq!(all_day.ends_at.as_deref(), Some("2026-07-11"));
        assert!(all_day.all_day);
    }

    #[test]
    fn google_event_create_payload_is_bounded_and_uses_google_time_shapes() {
        let timed = google_calendar_create_payload(GoogleCalendarEventCreateRequest {
            title: " Focus block ".to_owned(),
            starts_at: "2026-07-09T09:00:00-07:00".to_owned(),
            ends_at: None,
            all_day: false,
        })
        .expect("timed event with omitted end should be valid");
        assert_eq!(timed.summary, "Focus block");
        assert_eq!(
            timed.start.date_time.as_deref(),
            Some("2026-07-09T09:00:00-07:00")
        );
        assert_eq!(timed.start.date, None);
        assert_eq!(
            timed.end.date_time.as_deref(),
            Some("2026-07-09T09:30:00-07:00")
        );

        let all_day = google_calendar_create_payload(GoogleCalendarEventCreateRequest {
            title: "Day off".to_owned(),
            starts_at: "2026-07-10".to_owned(),
            ends_at: None,
            all_day: true,
        })
        .expect("all-day event with omitted end should be valid");
        assert_eq!(all_day.start.date.as_deref(), Some("2026-07-10"));
        assert_eq!(all_day.end.date.as_deref(), Some("2026-07-11"));

        let invalid = google_calendar_create_payload(GoogleCalendarEventCreateRequest {
            title: "Invalid duration".to_owned(),
            starts_at: "2026-07-09T09:00:00Z".to_owned(),
            ends_at: Some("2026-07-09T09:00:00Z".to_owned()),
            all_day: false,
        });
        assert!(matches!(
            invalid,
            Err(ProviderError::Validation {
                field: "endsAt",
                ..
            })
        ));

        let malformed_all_day = google_calendar_create_payload(GoogleCalendarEventCreateRequest {
            title: "Malformed".to_owned(),
            starts_at: "2026".to_owned(),
            ends_at: None,
            all_day: true,
        });
        assert!(matches!(
            malformed_all_day,
            Err(ProviderError::Validation {
                field: "startsAt",
                ..
            })
        ));

        let oversized_all_day = google_calendar_create_payload(GoogleCalendarEventCreateRequest {
            title: "Too long".to_owned(),
            starts_at: "2026-07-01".to_owned(),
            ends_at: Some("2026-08-02".to_owned()),
            all_day: true,
        });
        assert!(matches!(
            oversized_all_day,
            Err(ProviderError::Validation {
                field: "endsAt",
                ..
            })
        ));
    }
}
