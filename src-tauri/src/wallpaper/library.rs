//! App-owned wallpaper media library.
//!
//! Ordinary images and videos are copied into Ambient Glass's local data
//! directory before the webview can render them. The source path is never
//! persisted or returned, and the renderer receives access only to a narrow
//! asset-protocol scope containing the managed media files.

use std::{
    fmt::Write as _,
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use super::CommandError;

const LIBRARY_DIRECTORY: &str = "wallpapers";
const METADATA_FILE: &str = "metadata.json";
const METADATA_VERSION: u8 = 1;
const MAX_IMPORT_FILES: usize = 100;
const MAX_LIBRARY_FILES: usize = 250;
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_LIBRARY_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const MAX_METADATA_BYTES: u64 = 64 * 1024;
const MAX_SIGNATURE_SCAN_BYTES: u64 = 1024 * 1024;
const MAX_IMAGE_DIMENSION: u32 = 32_768;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WallpaperMediaKind {
    Image,
    Video,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperLibraryItem {
    pub id: String,
    pub display_name: String,
    pub kind: WallpaperMediaKind,
    pub mime_type: String,
    pub size_bytes: u64,
    pub imported_at: String,
    /// App-owned destination only. The frontend converts it to an asset URL
    /// and must never persist, display, or log it.
    pub file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperLibrarySnapshot {
    pub items: Vec<WallpaperLibraryItem>,
    pub total_bytes: u64,
    pub ignored_count: usize,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WallpaperImportFailureReason {
    Unsupported,
    TooLarge,
    Unreadable,
    CopyFailed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperImportFailure {
    pub display_name: String,
    pub reason: WallpaperImportFailureReason,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperImportResult {
    pub library: WallpaperLibrarySnapshot,
    pub imported_ids: Vec<String>,
    pub duplicate_ids: Vec<String>,
    pub rejected: Vec<WallpaperImportFailure>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredWallpaperMetadata {
    version: u8,
    id: String,
    display_name: String,
    kind: WallpaperMediaKind,
    mime_type: String,
    size_bytes: u64,
    imported_at: String,
    file_name: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MediaFormat {
    Jpeg,
    Png,
    Webp,
    Mp4,
    Webm,
}

impl MediaFormat {
    const fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Webp => "webp",
            Self::Mp4 => "mp4",
            Self::Webm => "webm",
        }
    }

    const fn mime_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
            Self::Mp4 => "video/mp4",
            Self::Webm => "video/webm",
        }
    }

    const fn kind(self) -> WallpaperMediaKind {
        match self {
            Self::Jpeg | Self::Png | Self::Webp => WallpaperMediaKind::Image,
            Self::Mp4 | Self::Webm => WallpaperMediaKind::Video,
        }
    }

    fn accepts_extension(self, extension: &str) -> bool {
        match self {
            Self::Jpeg => {
                extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg")
            }
            _ => extension.eq_ignore_ascii_case(self.extension()),
        }
    }

    fn from_metadata(metadata: &StoredWallpaperMetadata) -> Option<Self> {
        match (
            metadata.kind,
            metadata.mime_type.as_str(),
            metadata.file_name.as_str(),
        ) {
            (WallpaperMediaKind::Image, "image/jpeg", "media.jpg") => Some(Self::Jpeg),
            (WallpaperMediaKind::Image, "image/png", "media.png") => Some(Self::Png),
            (WallpaperMediaKind::Image, "image/webp", "media.webp") => Some(Self::Webp),
            (WallpaperMediaKind::Video, "video/mp4", "media.mp4") => Some(Self::Mp4),
            (WallpaperMediaKind::Video, "video/webm", "media.webm") => Some(Self::Webm),
            _ => None,
        }
    }
}

/// Serializes scans, imports, and deletes so content-addressed directory
/// installation remains deterministic even if the UI double-submits.
#[derive(Default)]
pub struct WallpaperLibraryController {
    operation: Mutex<()>,
}

impl WallpaperLibraryController {
    pub fn list(&self, app: &AppHandle) -> Result<WallpaperLibrarySnapshot, CommandError> {
        let _guard = self.lock()?;
        LibraryStore::for_app(app)?.snapshot()
    }

    pub fn import(
        &self,
        app: &AppHandle,
        paths: Vec<PathBuf>,
    ) -> Result<WallpaperImportResult, CommandError> {
        if paths.len() > MAX_IMPORT_FILES {
            return Err(CommandError::Validation {
                field: "paths",
                message: format!("Choose at most {MAX_IMPORT_FILES} wallpapers at one time."),
            });
        }

        let _guard = self.lock()?;
        LibraryStore::for_app(app)?.import(paths)
    }

    pub fn delete(
        &self,
        app: &AppHandle,
        id: &str,
    ) -> Result<WallpaperLibrarySnapshot, CommandError> {
        if !valid_asset_id(id) {
            return Err(CommandError::Validation {
                field: "id",
                message: "The wallpaper identifier is invalid.".to_owned(),
            });
        }

        let _guard = self.lock()?;
        LibraryStore::for_app(app)?.delete(id)
    }

    pub fn reveal(&self, app: &AppHandle) -> Result<(), CommandError> {
        let _guard = self.lock()?;
        let store = LibraryStore::for_app(app)?;
        store.ensure_root()?;
        app.opener()
            .open_path(store.root.to_string_lossy(), None::<&str>)
            .map_err(|_| CommandError::Storage {
                message: "The wallpaper library folder could not be opened.".to_owned(),
            })
    }

    fn lock(&self) -> Result<MutexGuard<'_, ()>, CommandError> {
        self.operation.lock().map_err(|_| CommandError::State {
            message: "The wallpaper library is temporarily unavailable.".to_owned(),
        })
    }
}

struct LibraryStore {
    root: PathBuf,
}

impl LibraryStore {
    fn for_app(app: &AppHandle) -> Result<Self, CommandError> {
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|_| CommandError::Storage {
                message: "The local wallpaper library directory is unavailable.".to_owned(),
            })?
            .join(LIBRARY_DIRECTORY);
        Ok(Self { root })
    }

    #[cfg(test)]
    fn at(root: PathBuf) -> Self {
        Self { root }
    }

    fn ensure_root(&self) -> Result<(), CommandError> {
        match fs::symlink_metadata(&self.root) {
            Ok(metadata) if is_unlinked_directory(&metadata) => Ok(()),
            Ok(_) => Err(CommandError::Storage {
                message: "The local wallpaper library directory is not safe to use.".to_owned(),
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir_all(&self.root).map_err(|_| CommandError::Storage {
                    message: "The local wallpaper library directory could not be created."
                        .to_owned(),
                })?;
                let metadata =
                    fs::symlink_metadata(&self.root).map_err(|_| CommandError::Storage {
                        message: "The local wallpaper library directory could not be verified."
                            .to_owned(),
                    })?;
                if is_unlinked_directory(&metadata) {
                    Ok(())
                } else {
                    Err(CommandError::Storage {
                        message: "The local wallpaper library directory is not safe to use."
                            .to_owned(),
                    })
                }
            }
            Err(_) => Err(CommandError::Storage {
                message: "The local wallpaper library directory could not be verified.".to_owned(),
            }),
        }
    }

    fn snapshot(&self) -> Result<WallpaperLibrarySnapshot, CommandError> {
        self.ensure_root()?;
        self.cleanup_partial_imports();

        let entries = fs::read_dir(&self.root).map_err(|_| CommandError::Storage {
            message: "The wallpaper library could not be read.".to_owned(),
        })?;
        let mut items = Vec::new();
        let mut ignored_count = 0usize;

        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().into_owned();
            if !valid_asset_id(&id) {
                if !id.starts_with(".import-") {
                    ignored_count = ignored_count.saturating_add(1);
                }
                continue;
            }
            match self.read_item(&entry.path(), &id) {
                Some(item) => items.push(item),
                None => ignored_count = ignored_count.saturating_add(1),
            }
        }

        items.sort_by(|left, right| {
            right
                .imported_at
                .cmp(&left.imported_at)
                .then_with(|| left.display_name.cmp(&right.display_name))
        });
        let total_bytes = items
            .iter()
            .fold(0u64, |total, item| total.saturating_add(item.size_bytes));
        Ok(WallpaperLibrarySnapshot {
            items,
            total_bytes,
            ignored_count,
        })
    }

    fn import(&self, paths: Vec<PathBuf>) -> Result<WallpaperImportResult, CommandError> {
        self.ensure_root()?;
        self.cleanup_partial_imports();

        let existing = self.snapshot()?;
        let mut library_files = existing.items.len();
        let mut library_bytes = existing.total_bytes;

        let mut imported_ids = Vec::new();
        let mut duplicate_ids = Vec::new();
        let mut rejected = Vec::new();

        for source in paths {
            let display_name = safe_display_name(&source);
            match self.import_one(&source, &display_name, library_files, library_bytes) {
                Ok(ImportOutcome::Imported(id, size_bytes)) => {
                    imported_ids.push(id);
                    library_files = library_files.saturating_add(1);
                    library_bytes = library_bytes.saturating_add(size_bytes);
                }
                Ok(ImportOutcome::Duplicate(id)) => duplicate_ids.push(id),
                Err(reason) => rejected.push(WallpaperImportFailure {
                    display_name,
                    reason,
                }),
            }
        }

        imported_ids.sort();
        imported_ids.dedup();
        duplicate_ids.sort();
        duplicate_ids.dedup();

        Ok(WallpaperImportResult {
            library: self.snapshot()?,
            imported_ids,
            duplicate_ids,
            rejected,
        })
    }

    fn import_one(
        &self,
        source: &Path,
        display_name: &str,
        library_files: usize,
        library_bytes: u64,
    ) -> Result<ImportOutcome, WallpaperImportFailureReason> {
        if !safe_import_source(source) {
            return Err(WallpaperImportFailureReason::Unreadable);
        }
        let source = source
            .canonicalize()
            .map_err(|_| WallpaperImportFailureReason::Unreadable)?;
        let mut input =
            File::open(&source).map_err(|_| WallpaperImportFailureReason::Unreadable)?;
        let source_metadata = input
            .metadata()
            .map_err(|_| WallpaperImportFailureReason::Unreadable)?;
        if !source_metadata.is_file() || source_metadata.len() == 0 {
            return Err(WallpaperImportFailureReason::Unreadable);
        }
        if source_metadata.len() > MAX_FILE_BYTES {
            return Err(WallpaperImportFailureReason::TooLarge);
        }

        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .ok_or(WallpaperImportFailureReason::Unsupported)?;
        let format =
            sniff_media_format(&mut input).ok_or(WallpaperImportFailureReason::Unsupported)?;
        if !format.accepts_extension(extension) {
            return Err(WallpaperImportFailureReason::Unsupported);
        }
        input
            .seek(SeekFrom::Start(0))
            .map_err(|_| WallpaperImportFailureReason::Unreadable)?;

        let temporary = self
            .root
            .join(format!(".import-{:032x}", rand::random::<u128>()));
        fs::create_dir(&temporary).map_err(|_| WallpaperImportFailureReason::CopyFailed)?;
        let media_name = format!("media.{}", format.extension());
        let temporary_media = temporary.join(&media_name);
        let copy_result = copy_and_hash(&mut input, &temporary_media, source_metadata.len());
        let (id, copied_bytes) = match copy_result {
            Ok(value) => value,
            Err(()) => {
                let _ = fs::remove_dir_all(&temporary);
                return Err(WallpaperImportFailureReason::CopyFailed);
            }
        };

        let final_directory = self.root.join(&id);
        if final_directory.exists() {
            let valid_existing = self.read_item(&final_directory, &id).is_some();
            if valid_existing {
                let _ = fs::remove_dir_all(&temporary);
                return Ok(ImportOutcome::Duplicate(id));
            }
            let final_metadata = fs::symlink_metadata(&final_directory)
                .map_err(|_| WallpaperImportFailureReason::CopyFailed)?;
            if !is_unlinked_directory(&final_metadata) {
                let _ = fs::remove_dir_all(&temporary);
                return Err(WallpaperImportFailureReason::CopyFailed);
            }
            fs::remove_dir_all(&final_directory)
                .map_err(|_| WallpaperImportFailureReason::CopyFailed)?;
        }
        if library_files >= MAX_LIBRARY_FILES
            || copied_bytes > MAX_LIBRARY_BYTES.saturating_sub(library_bytes)
        {
            let _ = fs::remove_dir_all(&temporary);
            return Err(WallpaperImportFailureReason::TooLarge);
        }

        let metadata = StoredWallpaperMetadata {
            version: METADATA_VERSION,
            id: id.clone(),
            display_name: display_name.to_owned(),
            kind: format.kind(),
            mime_type: format.mime_type().to_owned(),
            size_bytes: copied_bytes,
            imported_at: Utc::now().to_rfc3339(),
            file_name: media_name,
        };
        if write_metadata(&temporary.join(METADATA_FILE), &metadata).is_err()
            || fs::rename(&temporary, &final_directory).is_err()
        {
            let _ = fs::remove_dir_all(&temporary);
            return Err(WallpaperImportFailureReason::CopyFailed);
        }

        Ok(ImportOutcome::Imported(id, copied_bytes))
    }

    fn delete(&self, id: &str) -> Result<WallpaperLibrarySnapshot, CommandError> {
        self.ensure_root()?;
        let directory = self.root.join(id);
        match fs::symlink_metadata(&directory) {
            Ok(metadata) if is_unlinked_directory(&metadata) => {
                fs::remove_dir_all(&directory).map_err(|_| CommandError::Storage {
                    message: "The imported wallpaper could not be removed.".to_owned(),
                })?;
            }
            Ok(_) => {
                return Err(CommandError::Storage {
                    message: "The imported wallpaper could not be removed safely.".to_owned(),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                return Err(CommandError::Storage {
                    message: "The imported wallpaper could not be removed.".to_owned(),
                });
            }
        }
        self.snapshot()
    }

    fn read_item(&self, directory: &Path, expected_id: &str) -> Option<WallpaperLibraryItem> {
        let directory_metadata = fs::symlink_metadata(directory).ok()?;
        if !is_unlinked_directory(&directory_metadata) {
            return None;
        }

        let metadata_path = directory.join(METADATA_FILE);
        let metadata_file_metadata = fs::symlink_metadata(&metadata_path).ok()?;
        if !metadata_file_metadata.file_type().is_file()
            || metadata_file_metadata.len() > MAX_METADATA_BYTES
        {
            return None;
        }
        let metadata: StoredWallpaperMetadata =
            serde_json::from_slice(&fs::read(metadata_path).ok()?).ok()?;
        if metadata.version != METADATA_VERSION
            || metadata.id != expected_id
            || !valid_asset_id(&metadata.id)
            || metadata.display_name.trim().is_empty()
        {
            return None;
        }
        let format = MediaFormat::from_metadata(&metadata)?;
        let media_path = directory.join(&metadata.file_name);
        let media_metadata = fs::symlink_metadata(&media_path).ok()?;
        if !media_metadata.file_type().is_file()
            || media_metadata.len() == 0
            || media_metadata.len() != metadata.size_bytes
            || media_metadata.len() > MAX_FILE_BYTES
        {
            return None;
        }
        let mut media = File::open(&media_path).ok()?;
        if sniff_media_format(&mut media)? != format {
            return None;
        }

        Some(WallpaperLibraryItem {
            id: metadata.id,
            display_name: metadata.display_name,
            kind: metadata.kind,
            mime_type: metadata.mime_type,
            size_bytes: metadata.size_bytes,
            imported_at: metadata.imported_at,
            file_path: media_path.to_string_lossy().into_owned(),
        })
    }

    fn cleanup_partial_imports(&self) {
        let Ok(entries) = fs::read_dir(&self.root) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with(".import-") {
                let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
                    continue;
                };
                if is_unlinked_directory(&metadata) {
                    let _ = fs::remove_dir_all(entry.path());
                }
            }
        }
    }
}

#[derive(Debug)]
enum ImportOutcome {
    Imported(String, u64),
    Duplicate(String),
}

fn safe_display_name(path: &Path) -> String {
    let raw = path
        .file_stem()
        .or_else(|| path.file_name())
        .map(|value| value.to_string_lossy())
        .unwrap_or_else(|| "Wallpaper".into());
    let cleaned: String = raw
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        "Wallpaper".to_owned()
    } else {
        cleaned.to_owned()
    }
}

fn valid_asset_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_unlinked_directory(metadata: &fs::Metadata) -> bool {
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return false;
        }
    }
    true
}

fn safe_import_source(path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        use std::{os::windows::fs::MetadataExt, path::Component, path::Prefix};
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return false;
        }
        if !matches!(
            path.components().next(),
            Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_))
        ) {
            return false;
        }
    }
    true
}

fn sniff_media_format(file: &mut File) -> Option<MediaFormat> {
    let file_bytes = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(0)).ok()?;
    let mut header = [0u8; 16];
    let read = file.read(&mut header).ok()?;
    let bytes = &header[..read];

    let format = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        validate_jpeg(file, file_bytes).then_some(MediaFormat::Jpeg)
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        validate_png(file, file_bytes).then_some(MediaFormat::Png)
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        validate_webp(file, file_bytes).then_some(MediaFormat::Webp)
    } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        validate_mp4(file, file_bytes).then_some(MediaFormat::Mp4)
    } else if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        validate_webm(file, file_bytes).then_some(MediaFormat::Webm)
    } else {
        None
    };
    let _ = file.seek(SeekFrom::Start(0));
    format
}

fn validate_png(file: &mut File, file_bytes: u64) -> bool {
    if file_bytes < 57 || file.seek(SeekFrom::Start(8)).is_err() {
        return false;
    }
    let mut offset = 8u64;
    let mut chunk_index = 0usize;
    let mut saw_idat = false;

    while offset.saturating_add(12) <= file_bytes && chunk_index < 100_000 {
        let mut header = [0u8; 8];
        if file.read_exact(&mut header).is_err() {
            return false;
        }
        let chunk_bytes = u64::from(u32::from_be_bytes(
            header[0..4].try_into().expect("fixed PNG chunk length"),
        ));
        let chunk_type = &header[4..8];
        let Some(chunk_end) = offset
            .checked_add(12)
            .and_then(|value| value.checked_add(chunk_bytes))
        else {
            return false;
        };
        if chunk_end > file_bytes {
            return false;
        }

        if chunk_index == 0 {
            if chunk_type != b"IHDR" || chunk_bytes != 13 {
                return false;
            }
            let mut ihdr = [0u8; 13];
            let mut stored_crc = [0u8; 4];
            if file.read_exact(&mut ihdr).is_err() || file.read_exact(&mut stored_crc).is_err() {
                return false;
            }
            let width = u32::from_be_bytes(ihdr[0..4].try_into().expect("fixed IHDR width"));
            let height = u32::from_be_bytes(ihdr[4..8].try_into().expect("fixed IHDR height"));
            let bit_depth = ihdr[8];
            let color_type = ihdr[9];
            let valid_depth = matches!(
                (color_type, bit_depth),
                (0, 1 | 2 | 4 | 8 | 16)
                    | (2, 8 | 16)
                    | (3, 1 | 2 | 4 | 8)
                    | (4, 8 | 16)
                    | (6, 8 | 16)
            );
            let mut crc_input = Vec::with_capacity(17);
            crc_input.extend_from_slice(b"IHDR");
            crc_input.extend_from_slice(&ihdr);
            if width == 0
                || height == 0
                || width > MAX_IMAGE_DIMENSION
                || height > MAX_IMAGE_DIMENSION
                || !valid_depth
                || ihdr[10] != 0
                || ihdr[11] != 0
                || ihdr[12] > 1
                || u32::from_be_bytes(stored_crc) != png_crc32(&crc_input)
            {
                return false;
            }
        } else if chunk_type == b"IDAT" {
            if chunk_bytes == 0 || file.seek(SeekFrom::Current(chunk_bytes as i64)).is_err() {
                return false;
            }
            saw_idat = true;
            let mut crc = [0u8; 4];
            if file.read_exact(&mut crc).is_err() {
                return false;
            }
        } else if chunk_type == b"IEND" {
            if !saw_idat || chunk_bytes != 0 {
                return false;
            }
            let mut stored_crc = [0u8; 4];
            return file.read_exact(&mut stored_crc).is_ok()
                && u32::from_be_bytes(stored_crc) == png_crc32(b"IEND")
                && chunk_end == file_bytes;
        } else {
            if chunk_type[0].is_ascii_uppercase() && chunk_type != b"PLTE" {
                return false;
            }
            if file
                .seek(SeekFrom::Current(chunk_bytes.saturating_add(4) as i64))
                .is_err()
            {
                return false;
            }
        }
        offset = chunk_end;
        chunk_index = chunk_index.saturating_add(1);
    }
    false
}

fn png_crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn validate_jpeg(file: &mut File, file_bytes: u64) -> bool {
    if file_bytes < 16 || file.seek(SeekFrom::Start(2)).is_err() {
        return false;
    }
    let scan_limit = file_bytes.min(MAX_SIGNATURE_SCAN_BYTES);
    let mut position = 2u64;
    while position.saturating_add(4) <= scan_limit {
        let mut marker_prefix = [0u8; 1];
        if file.read_exact(&mut marker_prefix).is_err() {
            return false;
        }
        position += 1;
        if marker_prefix[0] != 0xFF {
            return false;
        }
        let marker = loop {
            let mut value = [0u8; 1];
            if file.read_exact(&mut value).is_err() {
                return false;
            }
            position += 1;
            if value[0] != 0xFF {
                break value[0];
            }
        };
        if marker == 0x00 || marker == 0xD8 {
            return false;
        }
        if marker == 0xD9 {
            return false;
        }
        if marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            continue;
        }

        let mut length_bytes = [0u8; 2];
        if file.read_exact(&mut length_bytes).is_err() {
            return false;
        }
        position += 2;
        let segment_bytes = u64::from(u16::from_be_bytes(length_bytes));
        if segment_bytes < 2 || position.saturating_add(segment_bytes - 2) > file_bytes {
            return false;
        }
        if matches!(
            marker,
            0xC0 | 0xC1
                | 0xC2
                | 0xC3
                | 0xC5
                | 0xC6
                | 0xC7
                | 0xC9
                | 0xCA
                | 0xCB
                | 0xCD
                | 0xCE
                | 0xCF
        ) {
            if segment_bytes < 8 {
                return false;
            }
            let mut frame = [0u8; 6];
            if file.read_exact(&mut frame).is_err() {
                return false;
            }
            let height = u32::from(u16::from_be_bytes([frame[1], frame[2]]));
            let width = u32::from(u16::from_be_bytes([frame[3], frame[4]]));
            return matches!(frame[0], 8 | 12 | 16)
                && width > 0
                && height > 0
                && width <= MAX_IMAGE_DIMENSION
                && height <= MAX_IMAGE_DIMENSION
                && frame[5] > 0;
        }
        if marker == 0xDA {
            return false;
        }
        let skip = segment_bytes - 2;
        if file.seek(SeekFrom::Current(skip as i64)).is_err() {
            return false;
        }
        position = position.saturating_add(skip);
    }
    false
}

fn validate_webp(file: &mut File, file_bytes: u64) -> bool {
    if file_bytes < 30 || file_bytes > u64::from(u32::MAX).saturating_add(8) {
        return false;
    }
    if file.seek(SeekFrom::Start(0)).is_err() {
        return false;
    }
    let mut header = [0u8; 30];
    if file.read_exact(&mut header).is_err()
        || &header[0..4] != b"RIFF"
        || &header[8..12] != b"WEBP"
        || u64::from(u32::from_le_bytes(
            header[4..8].try_into().expect("RIFF size"),
        )) + 8
            != file_bytes
    {
        return false;
    }
    let chunk_bytes = u64::from(u32::from_le_bytes(
        header[16..20].try_into().expect("WebP chunk size"),
    ));
    if chunk_bytes == 0 || 20u64.saturating_add(chunk_bytes) > file_bytes {
        return false;
    }
    match &header[12..16] {
        b"VP8 " => {
            let width = u32::from(u16::from_le_bytes([header[26], header[27]]) & 0x3FFF);
            let height = u32::from(u16::from_le_bytes([header[28], header[29]]) & 0x3FFF);
            chunk_bytes >= 10
                && header[23..26] == [0x9D, 0x01, 0x2A]
                && width > 0
                && height > 0
                && width <= MAX_IMAGE_DIMENSION
                && height <= MAX_IMAGE_DIMENSION
        }
        b"VP8L" => {
            let bits = u32::from_le_bytes([header[21], header[22], header[23], header[24]]);
            let width = (bits & 0x3FFF) + 1;
            let height = ((bits >> 14) & 0x3FFF) + 1;
            chunk_bytes >= 5
                && header[20] == 0x2F
                && width <= MAX_IMAGE_DIMENSION
                && height <= MAX_IMAGE_DIMENSION
                && bits >> 29 == 0
        }
        b"VP8X" => {
            chunk_bytes == 10
                && u32::from_le_bytes([header[24], header[25], header[26], 0]) < MAX_IMAGE_DIMENSION
                && u32::from_le_bytes([header[27], header[28], header[29], 0]) < MAX_IMAGE_DIMENSION
        }
        _ => false,
    }
}

fn validate_mp4(file: &mut File, file_bytes: u64) -> bool {
    if file_bytes < 24 || file.seek(SeekFrom::Start(0)).is_err() {
        return false;
    }
    let Some((first_size, first_type, first_header_bytes)) = read_iso_box_header(file, file_bytes)
    else {
        return false;
    };
    if first_type != *b"ftyp" || first_size < first_header_bytes.saturating_add(8) {
        return false;
    }
    let payload_bytes = first_size - first_header_bytes;
    if payload_bytes % 4 != 0 || payload_bytes > 4096 {
        return false;
    }
    let Ok(payload_length) = usize::try_from(payload_bytes) else {
        return false;
    };
    let mut brands = vec![0u8; payload_length];
    if file.read_exact(&mut brands).is_err()
        || brands[0..4].iter().all(|byte| *byte == 0)
        || brands[0..4]
            .iter()
            .any(|byte| !byte.is_ascii_graphic() && *byte != b' ')
    {
        return false;
    }

    let mut offset = first_size;
    let scan_limit = file_bytes.min(MAX_SIGNATURE_SCAN_BYTES);
    while offset.saturating_add(8) <= scan_limit {
        if file.seek(SeekFrom::Start(offset)).is_err() {
            return false;
        }
        let Some((box_size, box_type, _)) = read_iso_box_header(file, file_bytes - offset) else {
            return false;
        };
        if matches!(&box_type, b"moov" | b"moof" | b"mdat") {
            return true;
        }
        offset = match offset.checked_add(box_size) {
            Some(value) if value <= file_bytes => value,
            _ => return false,
        };
    }
    false
}

fn read_iso_box_header(file: &mut File, remaining_file_bytes: u64) -> Option<(u64, [u8; 4], u64)> {
    let mut header = [0u8; 8];
    file.read_exact(&mut header).ok()?;
    let size32 = u32::from_be_bytes(header[0..4].try_into().ok()?);
    let box_type = header[4..8].try_into().ok()?;
    let (box_bytes, header_bytes) = match size32 {
        0 => (remaining_file_bytes, 8),
        1 => {
            let mut extended = [0u8; 8];
            file.read_exact(&mut extended).ok()?;
            (u64::from_be_bytes(extended), 16)
        }
        value => (u64::from(value), 8),
    };
    (box_bytes >= header_bytes && box_bytes <= remaining_file_bytes).then_some((
        box_bytes,
        box_type,
        header_bytes,
    ))
}

fn validate_webm(file: &mut File, file_bytes: u64) -> bool {
    if file_bytes < 16 || file.seek(SeekFrom::Start(0)).is_err() {
        return false;
    }
    let Ok(read_bytes) = usize::try_from(file_bytes.min(64 * 1024)) else {
        return false;
    };
    let mut bytes = vec![0u8; read_bytes];
    if file.read_exact(&mut bytes).is_err() || !bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return false;
    }
    let Some((header_bytes, encoded_size_bytes)) = read_ebml_vint(&bytes[4..]) else {
        return false;
    };
    let header_start = 4usize.saturating_add(encoded_size_bytes);
    let Ok(header_length) = usize::try_from(header_bytes) else {
        return false;
    };
    let Some(header_end) = header_start.checked_add(header_length) else {
        return false;
    };
    if header_bytes == 0 || header_end > bytes.len() {
        return false;
    }
    let header = &bytes[header_start..header_end];
    let Some(doc_type_offset) = header.windows(2).position(|value| value == [0x42, 0x82]) else {
        return false;
    };
    let size_offset = doc_type_offset.saturating_add(2);
    let Some((doc_type_bytes, doc_type_size_bytes)) = read_ebml_vint(&header[size_offset..]) else {
        return false;
    };
    let value_start = size_offset.saturating_add(doc_type_size_bytes);
    let Ok(doc_type_length) = usize::try_from(doc_type_bytes) else {
        return false;
    };
    let Some(value_end) = value_start.checked_add(doc_type_length) else {
        return false;
    };
    value_end <= header.len()
        && &header[value_start..value_end] == b"webm"
        && bytes[header_end..].starts_with(&[0x18, 0x53, 0x80, 0x67])
}

fn read_ebml_vint(bytes: &[u8]) -> Option<(u64, usize)> {
    let first = *bytes.first()?;
    let width = first.leading_zeros() as usize + 1;
    if first == 0 || width > 8 || bytes.len() < width {
        return None;
    }
    let marker_mask = 1u8 << (8 - width);
    let mut value = u64::from(first & (marker_mask - 1));
    for byte in &bytes[1..width] {
        value = (value << 8) | u64::from(*byte);
    }
    let unknown = (1u128 << (width * 7)) - 1;
    (u128::from(value) != unknown).then_some((value, width))
}

fn copy_and_hash(
    input: &mut File,
    destination: &Path,
    expected_bytes: u64,
) -> Result<(String, u64), ()> {
    let mut output = File::create(destination).map_err(|_| ())?;
    let mut hasher = Sha256::new();
    let mut copied = 0u64;
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = input.read(&mut buffer).map_err(|_| ())?;
        if read == 0 {
            break;
        }
        let read_bytes = u64::try_from(read).map_err(|_| ())?;
        let next_copied = copied.checked_add(read_bytes).ok_or(())?;
        if next_copied > expected_bytes || next_copied > MAX_FILE_BYTES {
            return Err(());
        }
        output.write_all(&buffer[..read]).map_err(|_| ())?;
        hasher.update(&buffer[..read]);
        copied = next_copied;
    }
    if copied != expected_bytes {
        return Err(());
    }
    output.flush().map_err(|_| ())?;
    output.sync_all().map_err(|_| ())?;

    let digest = hasher.finalize();
    let mut id = String::with_capacity(64);
    for byte in digest {
        write!(&mut id, "{byte:02x}").map_err(|_| ())?;
    }
    Ok((id, copied))
}

fn write_metadata(path: &Path, metadata: &StoredWallpaperMetadata) -> Result<(), ()> {
    let encoded = serde_json::to_vec_pretty(metadata).map_err(|_| ())?;
    let mut file = File::create(path).map_err(|_| ())?;
    file.write_all(&encoded).map_err(|_| ())?;
    file.flush().map_err(|_| ())?;
    file.sync_all().map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{
        png_crc32, safe_display_name, valid_asset_id, LibraryStore, WallpaperImportFailureReason,
        WallpaperMediaKind, MAX_LIBRARY_FILES,
    };

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "ambient-glass-wallpaper-test-{:032x}",
                rand::random::<u128>()
            ));
            fs::create_dir_all(&path).expect("test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn png_bytes() -> Vec<u8> {
        fn append_chunk(bytes: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
            bytes.extend_from_slice(&(data.len() as u32).to_be_bytes());
            bytes.extend_from_slice(kind);
            bytes.extend_from_slice(data);
            let mut crc_input = Vec::with_capacity(kind.len() + data.len());
            crc_input.extend_from_slice(kind);
            crc_input.extend_from_slice(data);
            bytes.extend_from_slice(&png_crc32(&crc_input).to_be_bytes());
        }

        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        append_chunk(
            &mut bytes,
            b"IHDR",
            &[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0],
        );
        append_chunk(
            &mut bytes,
            b"IDAT",
            &[0x78, 0x9C, 0x63, 0x60, 0x60, 0x60, 0, 0, 0, 4, 0, 1],
        );
        append_chunk(&mut bytes, b"IEND", &[]);
        bytes
    }

    #[test]
    fn imports_an_app_owned_copy_that_survives_source_deletion() {
        let temp = TestDirectory::new();
        let source = temp.0.join("Evening Lake.png");
        fs::write(&source, png_bytes()).expect("source wallpaper");
        let store = LibraryStore::at(temp.0.join("library"));

        let result = store.import(vec![source.clone()]).expect("import result");
        assert_eq!(result.imported_ids.len(), 1);
        assert!(result.rejected.is_empty());
        fs::remove_file(source).expect("remove original");

        let snapshot = store.snapshot().expect("library snapshot");
        assert_eq!(snapshot.items.len(), 1);
        assert_eq!(snapshot.items[0].display_name, "Evening Lake");
        assert_eq!(snapshot.items[0].kind, WallpaperMediaKind::Image);
        assert!(PathBuf::from(&snapshot.items[0].file_path).is_file());
    }

    #[test]
    fn duplicate_content_is_stored_only_once() {
        let temp = TestDirectory::new();
        let first = temp.0.join("first.png");
        let second = temp.0.join("second.png");
        fs::write(&first, png_bytes()).expect("first wallpaper");
        fs::write(&second, png_bytes()).expect("second wallpaper");
        let store = LibraryStore::at(temp.0.join("library"));

        let result = store.import(vec![first, second]).expect("import result");

        assert_eq!(result.imported_ids.len(), 1);
        assert_eq!(result.duplicate_ids.len(), 1);
        assert_eq!(result.library.items.len(), 1);
    }

    #[test]
    fn delete_removes_only_the_requested_managed_copy() {
        let temp = TestDirectory::new();
        let source = temp.0.join("remove-me.png");
        fs::write(&source, png_bytes()).expect("source wallpaper");
        let store = LibraryStore::at(temp.0.join("library"));
        let imported = store.import(vec![source.clone()]).expect("import result");
        let id = imported.imported_ids[0].clone();

        let snapshot = store.delete(&id).expect("delete result");
        assert!(snapshot.items.is_empty());
        assert!(!store.root.join(id).exists());
        assert!(source.exists());
    }

    #[test]
    fn scan_cleans_abandoned_partial_imports_and_ignores_unknown_entries() {
        let temp = TestDirectory::new();
        let store = LibraryStore::at(temp.0.join("library"));
        store.ensure_root().expect("library root");
        let partial = store.root.join(".import-abandoned");
        fs::create_dir(&partial).expect("partial import");
        fs::write(store.root.join("readme.txt"), b"not a wallpaper").expect("unknown entry");

        let snapshot = store.snapshot().expect("library snapshot");
        assert!(!partial.exists());
        assert_eq!(snapshot.ignored_count, 1);
    }

    #[test]
    fn rejects_extension_signature_mismatches() {
        let temp = TestDirectory::new();
        let disguised = temp.0.join("not-an-image.jpg");
        fs::write(&disguised, b"not really an image").expect("disguised file");
        let store = LibraryStore::at(temp.0.join("library"));

        let result = store.import(vec![disguised]).expect("import result");
        assert!(result.imported_ids.is_empty());
        assert!(matches!(
            result.rejected[0].reason,
            WallpaperImportFailureReason::Unsupported
        ));
    }

    #[test]
    fn rejects_magic_prefixes_without_valid_media_structure() {
        let temp = TestDirectory::new();
        let fixtures = [
            ("prefix-only.jpg", b"\xff\xd8\xff".as_slice()),
            ("prefix-only.png", b"\x89PNG\r\n\x1a\n".as_slice()),
            ("prefix-only.webp", b"RIFF\0\0\0\0WEBP".as_slice()),
            ("prefix-only.mp4", b"\0\0\0\x18ftyp".as_slice()),
            ("prefix-only.webm", b"\x1a\x45\xdf\xa3".as_slice()),
        ];
        let mut paths = Vec::new();
        for (name, prefix) in fixtures {
            let path = temp.0.join(name);
            let mut bytes = prefix.to_vec();
            bytes.extend_from_slice(&[0; 64]);
            fs::write(&path, bytes).expect("disguised media");
            paths.push(path);
        }
        let store = LibraryStore::at(temp.0.join("library"));

        let result = store.import(paths).expect("import result");
        assert!(result.imported_ids.is_empty());
        assert_eq!(result.rejected.len(), 5);
        assert!(result
            .rejected
            .iter()
            .all(|failure| matches!(failure.reason, WallpaperImportFailureReason::Unsupported)));
    }

    #[test]
    fn rejects_import_when_the_managed_library_quota_is_full() {
        let temp = TestDirectory::new();
        let source = temp.0.join("quota.png");
        fs::write(&source, png_bytes()).expect("source wallpaper");
        let store = LibraryStore::at(temp.0.join("library"));
        store.ensure_root().expect("library root");

        let reason = store
            .import_one(&source, "Quota", MAX_LIBRARY_FILES, 0)
            .expect_err("full library must reject another import");
        assert!(matches!(reason, WallpaperImportFailureReason::TooLarge));
        assert!(store.snapshot().expect("snapshot").items.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_library_root_without_touching_its_target() {
        use std::os::unix::fs::symlink;

        let temp = TestDirectory::new();
        let outside = temp.0.join("outside");
        fs::create_dir(&outside).expect("outside directory");
        let marker = outside.join("keep.txt");
        fs::write(&marker, b"keep").expect("outside marker");
        let root = temp.0.join("library");
        symlink(&outside, &root).expect("library symlink");
        let store = LibraryStore::at(root);

        assert!(store.ensure_root().is_err());
        assert_eq!(fs::read(marker).expect("marker remains"), b"keep");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_import_source() {
        use std::os::unix::fs::symlink;

        let temp = TestDirectory::new();
        let target = temp.0.join("target.png");
        fs::write(&target, png_bytes()).expect("target wallpaper");
        let source = temp.0.join("chosen.png");
        symlink(&target, &source).expect("source symlink");
        let store = LibraryStore::at(temp.0.join("library"));

        let result = store.import(vec![source]).expect("import result");
        assert!(result.imported_ids.is_empty());
        assert!(matches!(
            result.rejected[0].reason,
            WallpaperImportFailureReason::Unreadable
        ));
    }

    #[test]
    fn delete_accepts_only_content_hash_identifiers() {
        assert!(valid_asset_id(&"a".repeat(64)));
        assert!(!valid_asset_id("../wallpapers"));
        assert!(!valid_asset_id(&"A".repeat(64)));
        assert_eq!(
            safe_display_name(PathBuf::from("\u{7} lake.png").as_path()),
            "lake"
        );
    }
}
