// Prevents an extra Windows console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ambient_glass_lib::run();
}
