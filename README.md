# Design Review Widget

Figma Widget for Design files that reviews all screens inside the section where the widget is placed and renders a shared scorecard.

## Current scope

- Finds the nearest parent `Section`
- Reviews all screens inside that section
- Saves the latest result in widget synced state
- Shows:
  - overall `X/100` score
  - `Unmet / Partially Met / Met` counters
  - findings tabs
  - recommendations for non-met criteria

## Project structure

- `src/code.tsx` - widget UI and review engine
- `manifest.json` - widget manifest
- `scripts/build.mjs` - esbuild bundle script

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Build the widget:

```bash
npm run build
```

3. In Figma:
- `Plugins` -> `Development` -> `Import plugin from manifest...`
- choose `manifest.json`
- run the widget in a Design file

## GitHub

This project is scaffolded locally. To store it under your GitHub account, create a new repository in `https://github.com/AnnKhim` and then run:

```bash
git init
git add .
git commit -m "feat: add design review widget scaffold"
git branch -M main
git remote add origin https://github.com/AnnKhim/<repo-name>.git
git push -u origin main
```
