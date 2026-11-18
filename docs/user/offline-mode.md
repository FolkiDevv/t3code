# Offline mode

T3 Code starts offline. The server, the desktop app and the web app it serves open no connection
to another machine: no update checks, no product data, no T3 Connect, no pull request lookups, no
links to other environments and no images from the internet. Connections to this machine
(`localhost`, `127.0.0.1`, `::1`) still work, so local model servers and dev server previews keep
working, and other devices can still open this server.

Git and the source control CLIs (`gh`, `glab` and similar) that T3 Code runs itself are offline
too, so fetching, pushing and pull request actions from the app fail. Providers you run are not
restricted: a provider CLI such as Claude Code or Codex still reaches its own service.

To allow network access, set `T3CODE_OFFLINE=0` in the environment that starts T3 Code and restart
it. For the desktop app, the variable must be in the app's launch environment: start it from a
terminal, use `launchctl setenv T3CODE_OFFLINE 0` on macOS, or set a user environment variable on
Windows. The desktop app does not read it from your shell profile.
