# TurnkeyAI

Done-for-you AI automation for Australian SMEs. Static site (HTML/CSS/JS) + Netlify Forms + Resend confirmation email.

## Structure

```
.
├── index.html                  # Main landing page
├── 404.html                    # Custom 404
├── assets/
│   ├── brand.css               # Shared design system (used by all sub-pages)
│   └── shared.js               # Scroll-fade observer
├── blog/
│   ├── index.html              # Blog listing
│   └── posts/
│       ├── the-3-questions.html
│       ├── why-mac-mini.html
│       └── 7-day-deployment.html
├── legal/
│   ├── terms.html              # Terms of Service
│   └── privacy.html            # Privacy Policy (Australian Privacy Act)
├── netlify/
│   └── functions/
│       └── submission-created.js   # Auto-fires on form submit, sends confirmation email
├── netlify.toml                # Netlify build + functions config
├── robots.txt                  # SEO + GEO crawler permissions
├── sitemap.xml                 # XML sitemap
├── favicon.svg
├── logo.svg
└── mac-mini.svg
```

## Deploy

### One-time setup (you, in this directory)

```bash
cd /Users/maeldemets/Desktop/turnkeyai-redesign

# 1. Authenticate with Netlify (opens browser)
npx netlify-cli login

# 2. Connect this folder to a Netlify site
#    Choose: "Create & configure a new site"
#    Team: your team
#    Site name: turnkeyai (or anything)
npx netlify-cli init

# 3. Set the Resend API key as env var
#    Get a NEW key at https://resend.com/api-keys (rotate the leaked one)
npx netlify-cli env:set RESEND_API_KEY "re_NEW_KEY_HERE"

# 4. Deploy production
npx netlify-cli deploy --prod
```

### Connect to GitHub (optional but recommended)

```bash
# Create a private GitHub repo via web at:
#   https://github.com/new
# (name: turnkeyai-website, Private, no README, no gitignore)

# Then push:
git remote add origin https://github.com/YOUR_USERNAME/turnkeyai-website.git
git push -u origin main
```

After connecting GitHub, link the repo in Netlify dashboard:
**Site settings → Build & deploy → Continuous deployment → Link repository**.
Every `git push` to `main` will then auto-deploy.

## Form testing

The form on `index.html` posts to Netlify Forms (form name: `ai-audit`). On submit:

1. Netlify stores the submission in dashboard → **Forms**.
2. The `submission-created` function fires automatically.
3. Resend sends the confirmation email from `start@tkai.com.au` to the submitter.

To test live: submit the form on the production URL with your own email and check the Functions tab in Netlify for logs.

## Updating content

- **Blog post**: copy any file in `blog/posts/`, update title/meta/body. Add an entry to `blog/index.html` and `sitemap.xml`.
- **Email template**: edit `netlify/functions/submission-created.js`. Re-deploy with `npx netlify-cli deploy --prod`.
- **Branding**: edit `assets/brand.css`. All sub-pages auto-pick up changes.

## Domain

`tkai.com.au` is verified on Resend (sender: `start@tkai.com.au`). To point the domain at Netlify after deploy:

1. Netlify dashboard → **Domain management → Add custom domain → tkai.com.au**.
2. Update DNS at CrazyDomains: add the A record and CNAME Netlify provides.
3. Netlify auto-provisions SSL via Let's Encrypt.
