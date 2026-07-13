const COMMANDS: &[&str] = &[
    "get_wallpaper_engine_status",
    "configure_wallpaper_engine",
    "apply_wallpaper_scene",
    "test_wallpaper_scene",
    "close_in_app_wallpaper",
    "get_github_commits",
    "refresh_sports",
    "transcribe_audio",
    "save_provider_secret",
    "delete_provider_secret",
    "get_secure_token_storage_status",
    "begin_google_calendar_oauth",
    "complete_google_calendar_oauth",
    "disconnect_google_calendar",
    "get_google_calendar_today",
    "create_google_calendar_event",
    "list_native_alarms",
    "get_native_alarm_scheduler_status",
    "schedule_native_alarm",
    "snooze_native_alarm",
    "dismiss_native_alarm",
    "test_native_alarm",
    "mark_overlay_ready",
    "set_display_window_mode",
    "quit_application",
    "get_display_window_state",
    "get_display_monitors",
    "set_display_monitor",
];

fn main() {
    // `option_env!` in the native provider boundary deliberately reads this
    // public OAuth client ID at compile time. Rebuild when its build-time
    // value changes without ever forwarding it to the webview.
    println!("cargo:rerun-if-env-changed=AMBIENT_GOOGLE_CLIENT_ID");
    if let Ok(client_id) = std::env::var("AMBIENT_GOOGLE_CLIENT_ID") {
        // Do not let a malformed local environment value inject another Cargo
        // build directive. The provider performs its own stricter validation
        // before using the value in an authorization URL.
        if !client_id.bytes().any(|byte| byte.is_ascii_control()) {
            println!("cargo:rustc-env=AMBIENT_GOOGLE_CLIENT_ID={client_id}");
        }
    }
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to generate the Ambient Glass Tauri command permissions");
}
