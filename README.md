# OpenForge AI

OpenForge AI is a Windows desktop app for private local chat and for installing and running trusted open-source AI projects from GitHub. Its local-chat preset runs through llama.cpp on the user's computer; the GitHub launcher keeps project dependencies in app-managed environments and streams setup and run logs into the interface.

The built-in recipes are **Dolphin X1 Trinity Nano**, a compact local language model, and **Dark-BERT HTML Cluster Visualizer**, pinned to the upstream repository's final 2022 revision and installed with a modern compatibility environment rather than its obsolete CUDA-specific dependency freeze.

## Features

- Install llama.cpp from a pinned Windows Package Manager package after reviewing the exact command.
- Download and run Dolphin X1 Trinity Nano on demand, bound to a random loopback-only port.
- Chat through an isolated Electron bridge; the renderer never receives the local server API key.
- Keep chat history in the current app session unless the user clears or closes it.
- Install public `https://github.com/owner/repository` projects.
- Detect Python (`requirements.txt` or `pyproject.toml`) and Node (`package.json`) projects.
- Keep dependencies local to each project.
- Preview setup commands before approval.
- Configure launch arguments without shell interpolation.
- Stream logs, stop process trees, update generic repositories, reveal files, and remove managed projects.
- Restrict renderer access through an isolated Electron preload bridge.

## Important security boundary

Virtual environments isolate dependencies; they do **not** sandbox untrusted code. Package installation and launched projects run with the current Windows user's filesystem and network permissions. Install only repositories you have reviewed and trust. For hostile or unknown code, use Windows Sandbox, a virtual machine, or another operating-system-level isolation boundary.

OpenForge strips common credential and token environment variables before starting tools, refuses non-GitHub URLs, never uses shell interpolation for project launch arguments, and limits managed paths to its own project directory. These reduce risk but do not make arbitrary repositories safe.

## Development

Requirements:

- Node.js 22 or newer
- Git
- Python 3 for Python projects; the Dark-BERT preset requires Python 3.12 or newer
- Windows Package Manager (`winget`) for installing the local llama.cpp runtime

```powershell
npm install
npm run typecheck
npm test
npm run dev
```

## Build a Windows installer

```powershell
npm run package:win
```

The NSIS installer is written to the workspace `outputs` directory. It is unsigned, so Windows may show a SmartScreen warning until the build is code-signed.

## Local AI preset

The **Dolphin X1 Trinity Nano** preset is designed for locally controlled, minimally filtered chat. It does not provide provider-side moderation, but it is not described as literally unrestricted: the model can still refuse, fail, or produce incorrect and unsafe content.

Before anything is installed, OpenForge shows the fixed commands, the approximate 3.64 GB model download, and the relevant licenses. The runtime is the MIT-licensed llama.cpp project. The Dolphin fine-tune's model card labels its release Apache-2.0, while its Arcee Trinity Nano base has the OpenMDW-1.1 license; users must review and comply with both. Model files are downloaded on demand and are not bundled with OpenForge.

The local server binds only to `127.0.0.1`, uses a random port and per-session API key, disables its web interface, and accepts chat through validated main-process IPC. OpenForge does not expose model tool use or automatically execute model output.

## Dark-BERT preset

The preset:

- Pins source commit `d9c132be9d580848d20b15c795598a26273dce73` and the three Hugging Face model revisions.
- Ignores the upstream 2022 `requirements.txt` and installs an exact compatibility set into `.venv`.
- Requires a direct folder containing at least 51 HTML files and no nested folders.
- Uses ALBERT by default, with BERT and RoBERTa alternatives.
- Runs with the chosen output directory as its working directory, capturing all 39 expected PNG charts in one place.

The upstream project performs unsupervised clustering and visualization—not conventional zero-shot classification. It discards filenames and filters text through an English dictionary, so outputs require careful human interpretation.

## License

OpenForge AI is MIT licensed. Installed repositories, models, datasets, and other downloaded artifacts retain their own licenses.
