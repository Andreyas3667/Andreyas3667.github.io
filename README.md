# Andreyas: portfolio

Personal portfolio of **Andreyas, S.Kom.**, an Informatics graduate (Universitas Multi Data Palembang, 2026) working across IT infrastructure, web development and applied AI.

Live site: https://andreyas3667.github.io

Tip for recruiters: add `?for=web`, `?for=infra`, `?for=ai` or `?for=risk` to the URL to see the work most relevant to that role first.

## Projects in this repository

| Project | What it does | Techniques |
| --- | --- | --- |
| [CabaiScan](projects/cabaiscan/) | Identifies chili leaf conditions from a photo, using the method from my thesis | HSV colour histograms, GLCM texture features, K-Nearest Neighbors, leave-one-out cross-validation |
| [TanyaIT](projects/tanyait/) | Triages Indonesian IT helpdesk tickets, finds the fix and drafts the reply | Multinomial Naive Bayes, TF-IDF retrieval, Indonesian tokenizer and slang dictionary, learning from corrections |
| [BackupWatch](projects/backupwatch/) | Flags failed, missed, shrinking or ransomware-like backup runs from job logs | Robust z-score (median / MAD), schedule-gap detection, SVG charts |

Everything runs client-side in plain HTML, CSS and JavaScript with no build step and no data leaving the browser.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy

- **GitHub Pages:** push to a repository named `<username>.github.io`; Pages serves the `main` branch root.
- **Vercel:** import the repository (framework preset: Other, no build command) or drag this folder onto vercel.com/new.

## Contact

andreyasaja123@gmail.com · Palembang, Indonesia
