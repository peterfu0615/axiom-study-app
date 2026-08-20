fn main() {
    #[cfg(target_os = "macos")]
    stage_typst_sidecar();

    #[cfg(target_os = "macos")]
    build_vision_helper();

    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn stage_typst_sidecar() {
    use std::{env, fs, os::unix::fs::PermissionsExt, path::PathBuf, process::Command};

    const REQUIRED_VERSION: &str = "0.14.2";
    println!("cargo:rerun-if-env-changed=AXIOM_TYPST_BIN");

    let binary = env::var_os("AXIOM_TYPST_BIN")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            env::var_os("PATH").and_then(|path| {
                env::split_paths(&path)
                    .map(|directory| directory.join("typst"))
                    .find(|candidate| candidate.is_file())
            })
        })
        .expect("Typst 0.14.2 is required to build Axiom. Install it or set AXIOM_TYPST_BIN.");
    let version = Command::new(&binary)
        .arg("--version")
        .output()
        .expect("failed to run Typst while staging the offline renderer");
    assert!(version.status.success(), "failed to query Typst version");
    let version = String::from_utf8_lossy(&version.stdout);
    let expected = format!("typst {REQUIRED_VERSION}");
    assert!(
        version.trim() == expected || version.trim().starts_with(&format!("{expected} ")),
        "Axiom requires Typst {REQUIRED_VERSION}; found {}",
        version.trim()
    );

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let target = env::var("TARGET").expect("missing Cargo target triple");
    let binaries = manifest_dir.join("binaries");
    let output = binaries.join(format!("axiom-typst-{target}"));
    fs::create_dir_all(&binaries).expect("failed to create native binary directory");

    let source_metadata = fs::metadata(&binary).expect("failed to inspect Typst binary");
    let unchanged = fs::metadata(&output)
        .map(|metadata| metadata.len() == source_metadata.len())
        .unwrap_or(false);
    if !unchanged {
        fs::copy(&binary, &output).expect("failed to stage Typst sidecar");
    }
    let metadata = fs::metadata(&output).expect("failed to inspect staged Typst sidecar");
    if metadata.permissions().mode() & 0o111 == 0 {
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&output, permissions).expect("failed to mark Typst sidecar executable");
    }
}

#[cfg(target_os = "macos")]
fn build_vision_helper() {
    use std::{env, fs, os::unix::fs::PermissionsExt, path::PathBuf, process::Command};

    println!("cargo:rerun-if-changed=native/AxiomVision.swift");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let source = manifest_dir.join("native/AxiomVision.swift");
    let target = env::var("TARGET").expect("missing Cargo target triple");
    println!("cargo:rustc-env=AXIOM_TARGET={target}");
    let binaries = manifest_dir.join("binaries");
    let output = binaries.join(format!("axiom-vision-{target}"));
    let temporary_output = PathBuf::from(env::var("OUT_DIR").unwrap()).join("axiom-vision");
    println!(
        "cargo:rustc-env=AXIOM_VISION_HELPER={}",
        temporary_output.to_string_lossy()
    );

    fs::create_dir_all(&binaries).expect("failed to create native binary directory");

    let build_script = manifest_dir.join("build.rs");
    if vision_helper_needs_rebuild(&output, &[&source, &build_script]) {
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
                "-framework",
                "PDFKit",
            ])
            .status()
            .expect("failed to invoke swiftc for the Vision helper");

        assert!(status.success(), "failed to compile the Vision helper");
        fs::copy(&temporary_output, &output).expect("failed to update native helper");
    } else {
        // Debug commands execute from Cargo's OUT_DIR while packaged builds
        // consume the stable externalBin. Keep both paths byte-identical
        // without touching the watched externalBin on every Cargo rebuild.
        fs::copy(&output, &temporary_output).expect("failed to stage native helper for debug");
    }
    // Both Tauri's externalBin source and Cargo's debug helper must retain an
    // executable mode after a fresh checkout or copy.
    for helper in [&output, &temporary_output] {
        let metadata = fs::metadata(helper).expect("failed to inspect native helper");
        if metadata.permissions().mode() & 0o111 == 0 {
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(helper, permissions)
                .expect("failed to mark native helper executable");
        }
    }
}

#[cfg(target_os = "macos")]
fn vision_helper_needs_rebuild(output: &std::path::Path, inputs: &[&std::path::Path]) -> bool {
    let Ok(output_modified) = std::fs::metadata(output).and_then(|metadata| metadata.modified())
    else {
        return true;
    };
    inputs.iter().any(|input| {
        std::fs::metadata(input)
            .and_then(|metadata| metadata.modified())
            .map(|modified| modified > output_modified)
            .unwrap_or(true)
    })
}
