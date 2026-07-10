//! Commands exposed to the webview.
//!
//! Keep this module deliberately small: the frontend can request a named scene or
//! a named display mode, but it can never send a shell command or arbitrary argv.

pub mod alarms;
pub mod providers;
pub mod wallpaper;
pub mod windowing;
