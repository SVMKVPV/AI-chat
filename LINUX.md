# Building OpenForge AI for Windows and Parrot OS

The GitHub Actions workflow **Build Windows and Parrot OS installers** runs on Windows and Ubuntu runners. It builds an NSIS Windows installer and Debian `.deb` and Linux `.AppImage` packages.

1. In GitHub, open **Actions → Build Windows and Parrot OS installers → Run workflow** and select the feature branch.
2. Wait for both jobs to finish and download the artifacts from the workflow run.
3. On Parrot OS x86-64, install a built Debian package with `sudo apt install ./OpenForge-AI-*.deb`, or make the AppImage executable and launch it.
4. On Windows, run the NSIS installer.

**Important:** The application was originally Windows-specific. Packaging support does not establish that all runtime features work on Linux. The bundled llama.cpp installer relies on Windows `winget`; Linux requires a separate supported llama-server installation and runtime adaptation. Run and verify the Linux app in Parrot OS before distributing it. Third-party projects are not sandboxed.
