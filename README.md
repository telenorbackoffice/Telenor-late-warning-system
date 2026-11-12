# Late Login Portal – Netlify deploy

1. Push this whole folder to a GitHub repo (keep the folder structure).
2. In Netlify: Add new site > Import from Git > pick the repo. No build command needed; publish dir is `public`.
3. Site settings > Environment variables: add ADMIN_USER and ADMIN_PASS (use a strong password). Redeploy.
   If you skip this, the login falls back to Backoffice / Backoffice.
4. Open the site URL. Data is stored in Netlify Blobs and shared by everyone.
