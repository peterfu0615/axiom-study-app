fn main() {
    #[cfg(target_os = "macos")]
    build_vision_helper();

    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn build_vision_helper() {
    use std::{env, fs, path::PathBuf, process::Command};

    println!("cargo:rerun-if-changed=native/AxiomVision.swift");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let source = manifest_dir.join("native/AxiomVision.swift");
    let target = env::var("TARGET").expect("missing Cargo target triple");
    println!("cargo:rustc-env=AXIOM_TARGET={target}");
    let profile = env::var("PROFILE").expect("missing Cargo profile");
    let binaries = manifest_dir.join("binaries");
    let output = binaries.join(format!("axiom-vision-{target}"));
    let temporary_output = PathBuf::from(env::var("OUT_DIR").unwrap()).join("axiom-vision");
    println!(
        "cargo:rustc-env=AXIOM_VISION_HELPER={}",
        temporary_output.to_string_lossy()
    );

    fs::create_dir_all(&binaries).expect("failed to create native binary directory");

    let status = Command::new("xcrun")
        .args([
            "swiftc",
            source.to_str().unwrap(),
            "-o",
            temporary_output.to_str().unwrap(),
            "-parse-as-library",
            "-O",
            "-framework",
            "Vision",
            "-framework",
            "CoreImage",
            "-framework",
            "ImageIO",
            "-framework",
            "AVFoundation",
        ])
        .status()
        .expect("failed to invoke swiftc for the Vision helper");

    assert!(status.success(), "failed to compile the Vision helper");

    if profile != "debug" {
        let compiled = fs::read(&temporary_output).expect("failed to read native helper");
        let unchanged = fs::read(&output)
            .map(|current| current == compiled)
            .unwrap_or(false);
        if !unchanged {
            fs::write(&output, compiled).expect("failed to update native helper");
        }
    }
}
