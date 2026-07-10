//! Backend-only provider boundaries.
//!
//! Provider requests intentionally take no token argument. Credentials may be
//! written only through the fixed-slot save command and are never returned.

use tauri::{AppHandle, State};

use crate::providers::{
    GithubCommitsResponse, GoogleCalendarEvent, GoogleCalendarEventCreateRequest,
    GoogleCalendarOAuthResponse, GoogleCalendarTodayResponse, ProviderError,
    ProviderSecretMutationResponse, ProviderSecretSlot, ProviderService, SecureTokenStorageStatus,
    SportsRefreshResponse, TranscriptionRequest, TranscriptionResponse,
};

/// Fetches the GitHub contribution count for a local day through the backend
/// boundary. It never accepts a personal access token from the frontend.
#[tauri::command]
pub async fn get_github_commits(
    local_day: Option<String>,
    providers: State<'_, ProviderService>,
) -> Result<GithubCommitsResponse, ProviderError> {
    providers.github_commits(local_day.as_deref()).await
}

/// Refreshes TheSportsDB through the replaceable normalized provider boundary.
/// It serves deterministic data only when no native API key is configured.
#[tauri::command]
pub async fn refresh_sports(
    local_day: Option<String>,
    providers: State<'_, ProviderService>,
) -> Result<SportsRefreshResponse, ProviderError> {
    providers.refresh_sports(local_day.as_deref()).await
}

/// Accepts only a bounded, explicit push-to-talk buffer. It is dropped after
/// the native OpenAI request or immediately when transcription is unconfigured.
#[tauri::command]
pub async fn transcribe_audio(
    mime_type: String,
    duration_ms: u32,
    explicit_push_to_talk: bool,
    audio: Vec<u8>,
    providers: State<'_, ProviderService>,
) -> Result<TranscriptionResponse, ProviderError> {
    providers
        .transcribe(TranscriptionRequest {
            mime_type,
            duration_ms,
            explicit_push_to_talk,
            audio,
        })
        .await
}

/// Saves one validated provider credential directly to OS secure storage. The
/// caller may choose only a known slot and receives no secret in the response.
#[tauri::command]
pub fn save_provider_secret(
    slot: ProviderSecretSlot,
    value: String,
    providers: State<'_, ProviderService>,
) -> Result<ProviderSecretMutationResponse, ProviderError> {
    providers.save_secret(slot, value)
}

/// Deletes a known provider credential. This is intentionally idempotent so
/// settings cannot learn whether a value existed before the deletion request.
#[tauri::command]
pub fn delete_provider_secret(
    slot: ProviderSecretSlot,
    providers: State<'_, ProviderService>,
) -> Result<ProviderSecretMutationResponse, ProviderError> {
    providers.delete_secret(slot)
}

/// Reports only whether native secret slots are configured. It never returns a
/// token, token prefix, secret path, or provider request headers.
#[tauri::command]
pub fn get_secure_token_storage_status(
    providers: State<'_, ProviderService>,
) -> SecureTokenStorageStatus {
    providers.secret_storage_status()
}

/// Opens the OAuth consent URL in the default system browser. No OAuth URL,
/// code, state, verifier, access token, or refresh token is returned to the
/// webview; call `complete_google_calendar_oauth` to poll native completion.
#[tauri::command]
pub fn begin_google_calendar_oauth(
    app: AppHandle,
    providers: State<'_, ProviderService>,
) -> Result<GoogleCalendarOAuthResponse, ProviderError> {
    providers.begin_google_calendar_oauth(&app)
}

/// Polls the pending native loopback callback and stores a verified refresh
/// token in the OS credential store when Google consent has completed.
#[tauri::command]
pub async fn complete_google_calendar_oauth(
    providers: State<'_, ProviderService>,
) -> Result<GoogleCalendarOAuthResponse, ProviderError> {
    providers.complete_google_calendar_oauth().await
}

/// Removes the Google refresh token and native in-memory Google cache.
#[tauri::command]
pub fn disconnect_google_calendar(
    providers: State<'_, ProviderService>,
) -> Result<GoogleCalendarOAuthResponse, ProviderError> {
    providers.disconnect_google_calendar()
}

/// Fetches normalized events intersecting a local day. `local_day` remains
/// optional so existing callers that requested today's events keep working.
#[tauri::command]
pub async fn get_google_calendar_today(
    local_day: Option<String>,
    providers: State<'_, ProviderService>,
) -> Result<GoogleCalendarTodayResponse, ProviderError> {
    providers.google_calendar_today(local_day.as_deref()).await
}

/// Creates one validated event in the connected user's primary calendar. The
/// request carries no calendar ID, credential, attendee, attachment, or raw
/// Google event JSON.
#[tauri::command]
pub async fn create_google_calendar_event(
    event: GoogleCalendarEventCreateRequest,
    providers: State<'_, ProviderService>,
) -> Result<GoogleCalendarEvent, ProviderError> {
    providers.create_google_calendar_event(event).await
}
