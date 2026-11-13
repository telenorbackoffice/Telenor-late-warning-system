# Late Login Portal (Netlify)

Deploy: push this folder to GitHub, then import the repo in Netlify (no build command; publish dir `public`).

## Netlify environment variables (Site settings > Environment variables)
- ADMIN_USER / ADMIN_PASS: Backoffice login
- GMAIL_USER: the Gmail address that sends warnings
- GMAIL_APP_PASSWORD: 16-character Google App Password (Google Account > Security > 2-Step Verification > App passwords)
- CC_LIST: optional, comma-separated. Defaults to jayp@paktelusa.com

Redeploy after adding variables.

## Using it
1. Log in as Backoffice, pick a date, upload the attendance Excel (Store ID, Location, Employee Name, Global ID, Clock In Time).
2. Open Employee emails: fill in each employee's personal email (or import Global ID, Name, Email from Excel) and Save.
3. Pay period lates: from the 2nd late a Send warning button appears. The email lists every late so far (date, location, login time) and CCs the CC list.
4. Employee emails tab also holds the editable email wording.

Late = 9:43 AM or later Mon-Sat, 10:43 AM or later Sunday. Pay periods are 14 days from 26 Oct 2026.
Note: this is a fresh rebuild; data from the earlier version is not carried over.
