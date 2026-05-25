use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use std::env;

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
    let next_app_dir = resource_dir.join("app");
    let resource_root = env::current_dir()?;
    let home_dir = app.path().home_dir()?;

    // sidecar: 运行 Node.js + Next.js standalone server
    let sidecar = app.shell().sidecar("node")?;
    let (mut rx, _child) = sidecar
        .current_dir(&next_app_dir)
        .env("THETHING_DATA_DIR", &resource_root)
        .env("THETHING_RESOURCE_ROOT", &resource_root)
        .env("THETHING_HOME_DIR", &home_dir)
        .env("HOME", &home_dir)
        .env("USERPROFILE", &home_dir)
        .args(&["start-standalone.js", "-p", "0"])
        .spawn()?;

    eprintln!("[desktop] sidecar resource root: {}", resource_root.display());
    eprintln!("[desktop] sidecar home dir: {}", home_dir.display());

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
