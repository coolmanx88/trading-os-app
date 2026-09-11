# Trading OS — App Repository

Public static application repository for GitHub Pages. It contains no live trading data.

## Deploy

1. This repository hosts the Trading OS web application.
2. GitHub Pages is deployed by the included `.github/workflows/pages.yml` workflow.
3. Live trading records should be stored in a separate private `trading-os-data` repository.
4. Open the site → Settings and connect the private data repository using a fine-grained PAT.

The local `data/state.json` is only an empty bootstrap/template. Real records should live in the private data repository.
