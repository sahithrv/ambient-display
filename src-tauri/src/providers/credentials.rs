//! Narrow, native-only access to provider credentials.
//!
//! The webview can ask to save or delete one of the explicitly listed slots,
//! but it can never retrieve a value. On supported desktop platforms the
//! values live in the OS credential store (Windows Credential Manager or
//! macOS Keychain), rather than a Tauri Store file or frontend state.

use serde::{Deserialize, Serialize};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use keyring::{Entry, Error as KeyringError};

const KEYRING_SERVICE: &str = "io.ambientglass.display";
const MAX_PROVIDER_SECRET_BYTES: usize = 4 * 1024;

/// The complete, deliberately small allow-list of native credential slots.
///
/// Adding a provider requires adding a variant here and an explicit account
/// name below; callers cannot provide arbitrary keychain account names.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderSecretSlot {
    GithubToken,
    SportsApiKey,
    OpenaiApiKey,
    GoogleRefreshToken,
}

impl ProviderSecretSlot {
    const fn keyring_account(self) -> &'static str {
        match self {
            Self::GithubToken => "provider.github-token.v1",
            Self::SportsApiKey => "provider.thesportsdb-api-key.v1",
            Self::OpenaiApiKey => "provider.openai-api-key.v1",
            Self::GoogleRefreshToken => "provider.google-refresh-token.v1",
        }
    }

    pub const fn display_name(self) -> &'static str {
        match self {
            Self::GithubToken => "GitHub",
            Self::SportsApiKey => "TheSportsDB",
            Self::OpenaiApiKey => "OpenAI",
            Self::GoogleRefreshToken => "Google Calendar",
        }
    }
}

/// A deliberately redacted keychain result. Platform error strings may include
/// implementation details, so they are never passed through this boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CredentialStoreError {
    Unavailable,
}

/// Small abstraction around the OS keychain. It stores no state and never
/// exposes a method that would let the frontend enumerate keychain entries.
#[derive(Default)]
pub struct CredentialStore;

impl CredentialStore {
    pub fn save(&self, slot: ProviderSecretSlot, value: &str) -> Result<(), CredentialStoreError> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            native_entry(slot)?
                .set_password(value)
                .map_err(|_| CredentialStoreError::Unavailable)
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = (slot, value);
            Err(CredentialStoreError::Unavailable)
        }
    }

    /// Returns `Ok(None)` only when the known slot has no credential. Any
    /// platform/keychain failure is distinct so callers never treat an
    /// unavailable store as an intentionally disconnected provider.
    pub fn load(&self, slot: ProviderSecretSlot) -> Result<Option<String>, CredentialStoreError> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            match native_entry(slot)?.get_password() {
                Ok(value) => Ok(Some(value)),
                Err(KeyringError::NoEntry) => Ok(None),
                Err(_) => Err(CredentialStoreError::Unavailable),
            }
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = slot;
            Err(CredentialStoreError::Unavailable)
        }
    }

    /// Deletion is idempotent. A missing slot has already reached the caller's
    /// desired state and does not leak whether a credential ever existed.
    pub fn delete(&self, slot: ProviderSecretSlot) -> Result<(), CredentialStoreError> {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            match native_entry(slot)?.delete_credential() {
                Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
                Err(_) => Err(CredentialStoreError::Unavailable),
            }
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = slot;
            Err(CredentialStoreError::Unavailable)
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn native_entry(slot: ProviderSecretSlot) -> Result<Entry, CredentialStoreError> {
    Entry::new(KEYRING_SERVICE, slot.keyring_account())
        .map_err(|_| CredentialStoreError::Unavailable)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SecretValidationError {
    Empty,
    TooLong,
    Whitespace,
    InvalidCharacters,
}

impl SecretValidationError {
    pub const fn message(self, slot: ProviderSecretSlot) -> &'static str {
        match self {
            Self::Empty => "Enter a non-empty provider credential.",
            Self::TooLong => "Provider credentials must be at most 4 KiB.",
            Self::Whitespace => "Provider credentials cannot start, end, or contain whitespace.",
            Self::InvalidCharacters if matches!(slot, ProviderSecretSlot::SportsApiKey) => {
                "TheSportsDB API keys may contain only letters, numbers, hyphens, and underscores."
            }
            Self::InvalidCharacters => {
                "Provider credentials must use printable ASCII characters only."
            }
        }
    }
}

/// Validate before every keychain write and again before a stored credential is
/// used. The second check protects against malformed values inserted outside
/// this app without ever returning those values to the webview.
pub fn validate_provider_secret(
    slot: ProviderSecretSlot,
    value: &str,
) -> Result<(), SecretValidationError> {
    if value.is_empty() {
        return Err(SecretValidationError::Empty);
    }
    if value.len() > MAX_PROVIDER_SECRET_BYTES {
        return Err(SecretValidationError::TooLong);
    }
    if value.trim() != value || value.bytes().any(|byte| byte.is_ascii_whitespace()) {
        return Err(SecretValidationError::Whitespace);
    }
    if !value.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(SecretValidationError::InvalidCharacters);
    }
    if matches!(slot, ProviderSecretSlot::SportsApiKey)
        && !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(SecretValidationError::InvalidCharacters);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_provider_secret, ProviderSecretSlot, SecretValidationError};

    #[test]
    fn sports_key_is_deliberately_more_restricted_than_other_provider_tokens() {
        assert!(validate_provider_secret(ProviderSecretSlot::SportsApiKey, "1234_key-abc").is_ok());
        assert_eq!(
            validate_provider_secret(ProviderSecretSlot::SportsApiKey, "key/with-slash"),
            Err(SecretValidationError::InvalidCharacters)
        );
        assert!(
            validate_provider_secret(ProviderSecretSlot::GoogleRefreshToken, "1//token.value")
                .is_ok()
        );
    }

    #[test]
    fn secret_validation_rejects_whitespace_and_unbounded_input() {
        assert_eq!(
            validate_provider_secret(ProviderSecretSlot::GithubToken, " example-token"),
            Err(SecretValidationError::Whitespace)
        );
        assert_eq!(
            validate_provider_secret(ProviderSecretSlot::OpenaiApiKey, &"a".repeat(4097)),
            Err(SecretValidationError::TooLong)
        );
    }
}
