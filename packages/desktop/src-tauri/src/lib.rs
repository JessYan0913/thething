use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(not(dev))]
            spawn_sidecar(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(dev))]
fn spawn_sidecar(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();

    let resource_dir = app.path().resource_dir()?;
    let web_dir = resource_dir.join("web");

    let sidecar = app.shell().sidecar("thing")?;
    let (mut rx, _child) = sidecar
        .args(&[
            "serve",
            "--port", "0",
            "--web-dir", &web_dir.to_string_lossy(),
        ])
        .spawn()?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    if let Some(port_str) = line.strip_prefix("THETHING_PORT=") {
                        if let Ok(port) = port_str.trim().parse::<u16>() {
                            let url = format!("http://localhost:{}", port);
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.navigate(url.parse().unwrap());
                            }
                        }
                    }
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    eprintln!("[sidecar] {}", line);
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[sidecar] terminated: {:?}", status);
                }
                _ => {}
            }
        }
    });

    Ok(())
}
