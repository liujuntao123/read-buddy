use std::fs;
use tauri::Emitter;

/// Reads a book file's bytes for the webview (launched via file association
/// or CLI argument). The webview itself has no direct filesystem access.
#[tauri::command]
fn read_book_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("failed to read {path}: {e}"))
}

fn supported_book(path: &str) -> bool {
    ["epub", "mobi", "azw", "azw3", "prc", "fb2", "fbz", "cbz", "txt"]
        .iter()
        .any(|ext| path.to_lowercase().ends_with(&format!(".{ext}")))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_book_file])
        .setup(|app| {
            // Double-clicking an associated ebook launches the app with the
            // file path as argv; forward it to the webview once it is ready.
            if let Some(path) = std::env::args().skip(1).find(|arg| supported_book(arg)) {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    // Give the frontend a moment to attach its listener.
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    let _ = handle.emit("book-file-opened", path);
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running readest-plus");
}
