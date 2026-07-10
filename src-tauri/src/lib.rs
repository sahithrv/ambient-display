//! Ambient Glass's intentionally small native surface.
//!
//! The UI owns visual state. Native code owns the desktop responsibilities a
//! browser cannot safely perform: window behavior, secure provider requests,
//! registered emergency shortcuts, and constrained Wallpaper Engine control.

mod alarms;
mod commands;
mod providers;
mod wallpaper;
mod windowing;

use tauri::Manager;

pub fn run() {
    let app = tauri::Builder::default()
        .manage(wallpaper::WallpaperEngineController::default())
        .manage(windowing::DisplayWindowState::default())
        .manage(providers::ProviderService::new())
        // Store is for non-secret UI settings only. Provider credentials use
        // `CredentialStore`/the operating system keychain instead.
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        // OAuth uses the operating system's default browser; no consent page
        // is ever embedded in or exposed to the webview.
        .plugin(tauri_plugin_opener::init())
        // Only structured, fixed-field events are logged. Never log settings
        // values, paths, provider tokens, or arbitrary webview input.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            // Alarm storage is intentionally allowed to degrade to an explicit
            // in-memory scheduler so an unavailable app-data directory cannot
            // prevent the display from starting.
            let native_alarms = alarms::NativeAlarmScheduler::load(app.handle());
            app.manage(native_alarms);
            alarms::start_native_alarm_scheduler(app.handle().clone())?;
            windowing::prepare_main_window(app.handle())?;
            windowing::register_shortcuts(app.handle())?;
            let input_activity_monitor =
                windowing::InputActivityMonitor::start(app.handle().clone())?;
            app.manage(input_activity_monitor);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::wallpaper::get_wallpaper_engine_status,
            commands::wallpaper::configure_wallpaper_engine,
            commands::wallpaper::apply_wallpaper_scene,
            commands::wallpaper::test_wallpaper_scene,
            commands::providers::get_github_commits,
            commands::providers::refresh_sports,
            commands::providers::transcribe_audio,
            commands::providers::save_provider_secret,
            commands::providers::delete_provider_secret,
            commands::providers::get_secure_token_storage_status,
            commands::providers::begin_google_calendar_oauth,
            commands::providers::complete_google_calendar_oauth,
            commands::providers::disconnect_google_calendar,
            commands::providers::get_google_calendar_today,
            commands::providers::create_google_calendar_event,
            commands::alarms::list_native_alarms,
            commands::alarms::get_native_alarm_scheduler_status,
            commands::alarms::schedule_native_alarm,
            commands::alarms::snooze_native_alarm,
            commands::alarms::dismiss_native_alarm,
            commands::alarms::test_native_alarm,
            commands::windowing::mark_overlay_ready,
            commands::windowing::set_display_window_mode,
            commands::windowing::quit_application,
            commands::windowing::get_display_window_state,
            commands::windowing::get_display_monitors,
            commands::windowing::set_display_monitor,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Ambient Glass");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            alarms::stop_native_alarm_scheduler(app_handle);
            app_handle.state::<windowing::InputActivityMonitor>().stop();
        }
    });
}
