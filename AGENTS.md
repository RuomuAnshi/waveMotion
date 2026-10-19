# Repository workflow

- `dev` is the integration branch for ongoing development. Push development changes to `dev` (or open feature PRs targeting `dev`).
- `main` is the release branch. Do not push ordinary development changes or merge a development PR directly into `main`.
- Only prepare a release when requested: synchronize the version in `package.json` and `package-lock.json` on `dev`, validate tests and desktop packages, then open a `dev` → `main` release PR.
- Do not create release tags or publish releases as part of routine development. After a release, merge `main` back into `dev`.
- Keep original audio/video assets and generated runtimes/installers out of Git. Desktop data belongs in the user's application-data directory, never inside the installed app.
