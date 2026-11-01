# AI Video Agent

A Windows-first Electron desktop editor based on the original AI Video Agent HTML prototype. The original canvas engine, AI tool implementations, and embedded video-generation skill pack are retained in index.html; the desktop adapter provides secure Electron APIs, native project storage, and desktop settings.

## Current scope

- Windows 10/11 x64 desktop build only.
- Original prototype canvas scene engine and embedded 24-file SKILL_FILES / SKILL_ORDER pack.
- Chat-first studio with a 45% agent pane and always-visible video canvas.
- Electron main/preload separation with contextIsolation, sandbox, and no Node integration in the renderer.
- OpenAI-compatible provider settings; API keys stored in Electron safeStorage (Windows DPAPI).
- Native local project storage, project gallery, and 1.2-second autosave.
- Settings window: Appearance, Providers, Tools, Integrations, Music & SFX, Advanced, About.
- Windows 11 22H2+ Acrylic/Mica window material with an opaque fallback on unsupported builds.
- Windows NSIS installer and portable EXE.
- GitHub Actions CI, build artifacts, CodeQL, and draft release workflow.

The HTML prototype's embedded skills and rendering code are preserved as the source of truth. The desktop adapter is kept in desktop.js and visual updates in desktop.css, instead of rewriting the prototype engine.

## Requirements

- Windows 10/11 x64 for the packaged desktop app.
- Node.js 22 and npm for local development.
- A compatible AI provider and API key for agent requests.
- Internet connectivity for AI model requests and dependency installation.

## Run locally

~~~powershell
npm install
npm start
~~~

## Build Windows installers

~~~powershell
npm install
npm test
npm run dist:win
~~~

The output is written to dist/:
- AI-Video-Agent-1.0.0-x64-nsis.exe (NSIS installer)
- AI-Video-Agent-1.0.0-x64-portable.exe (portable executable)

## Building & releasing with GitHub Actions

Every pull request to main runs Windows CI checks. Pushes to main run the Windows package workflow and upload the NSIS and portable EXE files as workflow artifacts.

A tag matching the package version (for example v1.0.0) runs release.yml, which builds the Windows installers and publishes a draft GitHub Release. Review the build before promoting the draft release.

Optional code-signing secrets can be configured in Settings → Secrets and variables → Actions:

| Secret | Purpose |
| --- | --- |
| WIN_CSC_LINK | Base64-encoded Windows .pfx signing certificate |
| WIN_CSC_KEY_PASSWORD | Certificate password |

Code signing is optional. Without these secrets, the installers are unsigned and Windows SmartScreen may show a warning.

GitHub Actions supplies GITHUB_TOKEN automatically for draft release publishing. Do not add a PAT to the repository.

## Provider setup

1. Open Settings → Providers.
2. Add a provider name and OpenAI-compatible Base URL.
3. Enter the API key and choose Test connection & fetch models.
4. Select the models that should appear in the Studio model picker.
5. Save the provider and set it as active.

Keys are encrypted in the Electron main process and are not stored in the HTML, localStorage, or renderer preferences.

## Data and privacy

Projects and settings are stored in Electron's per-user userData folder. The app does not need a hosted account or browser login. API requests go to the AI provider selected by the user. Never commit API keys, certificates, local project data, or config/ into the repository.

## Important implementation notes

- The source prototype contains a 24-file embedded skill pack. Do not regenerate or replace those skill contents unless explicitly requested.
- New desktop features should be added through desktop.js, desktop.css, main.js, and preload.js so the prototype engine remains intact.
- FFmpeg integration and optional provider-backed integrations are being expanded incrementally. Do not advertise a feature as complete until it has a real end-to-end test.
- macOS and Linux builds are intentionally out of scope.

## License

MIT
