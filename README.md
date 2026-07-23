# GHBall

Turn your GitHub contribution graph into a self‑playing DX‑Ball animation.

[![npm version](https://img.shields.io/npm/v/ghball)](https://www.npmjs.com/package/ghball)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0-brightgreen)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-GHBall-blue?logo=github)](https://github.com/marketplace/actions/ghball)

<img src="https://github.com/Sayad-Uddin-Tahsin/GHBall/blob/GHBall/ghball.png"></img>

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="ghball-dark.svg">
  <img alt="GHBall Animation" src="ghball.svg" width="100%">
</picture>
```
*(Place this `<picture>` snippet in your README, commit the generated SVGs, and watch it come alive!)*


## GitHub Action (Recommended)

Add this workflow to **your own repository** at `.github/workflows/ghball.yml` to get a fresh animation every 2 hours.

```yaml
name: Generate GHBall Animation

on:
  schedule:
    - cron: '0 */2 * * *'   # Runs every 2 hours
  workflow_dispatch:      # Allows manual trigger

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Generate Light version (ghball.svg)
      - uses: Sayad-Uddin-Tahsin/ghball@v1
        with:
          username: ${{ github.repository_owner }}

      # Generate Dark version (ghball-dark.svg)
      - uses: Sayad-Uddin-Tahsin/ghball@v1
        with:
          username: ${{ github.repository_owner }}
          theme: dark
          score: true

      # Commit the SVGs back to your repo
      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add ghball*.svg
          git diff --staged --quiet || git commit -m "chore: update GHBall animations [skip ci]"
          git push
```

## Customize It
Add any of these options to the with: section of your workflow to tweak the gameplay.

| Option | Description | Default |
| :--- | :--- | :--- |
| `username` | GitHub username | `${{ github.repository_owner }}` |
| `speed` | Ball speed (pixels/second) | `450` |
| `max-miss` | Misses before the AI forces a hit | `3` |
| `theme` | `light` or `dark` | `light` |
| `score` | Show a live score counter | `false` |

```yaml
- uses: Sayad-Uddin-Tahsin/ghball@v1
  with:
    username: ${{ github.repository_owner }}
    speed: 600
    max-miss: 2
    theme: dark
    score: true
```

## Run Locally (CLI)
Prefer to test it on your machine? Install the CLI globally or run it instantly with npx.

Set your GitHub Token (only needed for local GraphQL API access):

```bash
export GITHUB_TOKEN=your_personal_access_token_here
```

Run it:

```bash
npx ghball --username torvalds --theme dark --score
```
Or if you cloned the repository:

```bash
node index.js --username torvalds --theme light
```

⭐ Star this repo if you think your GitHub grid looks a bit better.
