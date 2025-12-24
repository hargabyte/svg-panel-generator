# SVG Panel Generator - Deployment Guide

This guide will walk you through deploying the SVG Panel Generator to the web using Cloudflare Pages. This is a **100% client-side app** - all file processing happens in the browser. No files are ever uploaded to any server.

---

## Prerequisites

Before starting, you need:
1. A **GitHub account** (free): https://github.com/signup
2. A **Cloudflare account** (free): https://dash.cloudflare.com/sign-up
3. **Node.js** installed on your computer: https://nodejs.org (download the LTS version)
4. **Git** installed on your computer: https://git-scm.com/downloads

---

## Step 1: Test Locally First

Before deploying, make sure the app works on your computer.

### 1.1 Open a terminal/command prompt

- **Windows**: Press `Win + R`, type `cmd`, press Enter
- Or use PowerShell, Windows Terminal, or VS Code's integrated terminal

### 1.2 Navigate to the project folder

```bash
cd "d:\LaserEngraveKiosk\temp\Rebuild 0.4\tools\svg-panel-generator-web"
```

### 1.3 Install dependencies

```bash
npm install
```

This downloads all the libraries the app needs. Wait for it to finish (may take 1-2 minutes).

### 1.4 Build the app

```bash
npm run build
```

This compiles the TypeScript and creates the production files in the `dist/` folder.

### 1.5 Preview locally

```bash
npm run preview
```

This starts a local web server. Open your browser to the URL shown (usually http://localhost:4173).

- Drag and drop a folder containing SVG files onto the page
- Verify it works correctly (files appear in the list, preview generates properly)
- Press `Ctrl+C` in the terminal to stop the server

---

## Step 2: Create a GitHub Repository

GitHub stores your code and connects to Cloudflare for automatic deployments.

### 2.1 Create a new repository on GitHub

1. Go to https://github.com/new
2. **Repository name**: `svg-panel-generator` (or whatever you want)
3. **Description**: "SVG Panel Generator for laser engraving"
4. **Visibility**: Choose **Private** (only you can see it) or **Public**
5. Leave all checkboxes UNCHECKED (we'll push existing code)
6. Click **Create repository**

### 2.2 Push your code to GitHub

After creating the repo, GitHub shows instructions. In your terminal, run these commands:

```bash
# Navigate to the project folder
cd "d:\LaserEngraveKiosk\temp\Rebuild 0.4\tools\svg-panel-generator-web"

# Initialize git (only needed once)
git init

# Add all files
git add .

# Commit the files
git commit -m "Initial commit - SVG Panel Generator web version"

# Connect to your GitHub repo (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/svg-panel-generator.git

# Push to GitHub
git branch -M main
git push -u origin main
```

When prompted, enter your GitHub username and password (or personal access token).

**Note**: If you get an authentication error, you may need to create a Personal Access Token:
1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Give it a name, select "repo" scope, click "Generate token"
4. Copy the token and use it as your password

---

## Step 3: Deploy to Cloudflare Pages

Cloudflare Pages hosts your static website for free with a CDN (fast loading worldwide).

### 3.1 Connect Cloudflare to GitHub

1. Go to https://dash.cloudflare.com
2. Sign in or create an account
3. In the left sidebar, click **Workers & Pages**
4. Click **Create** (blue button)
5. Select the **Pages** tab
6. Click **Connect to Git**

### 3.2 Authorize GitHub

1. Click **Connect GitHub**
2. Sign in to GitHub if prompted
3. Click **Authorize Cloudflare** to give it access to your repos
4. Select your repository (`svg-panel-generator`)
5. Click **Begin setup**

### 3.3 Configure build settings

Fill in these settings:

| Setting | Value |
|---------|-------|
| **Project name** | `svg-panel-generator` (this becomes your URL) |
| **Production branch** | `main` |
| **Framework preset** | None |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory** | (leave empty) |

### 3.4 Deploy

1. Click **Save and Deploy**
2. Wait for the build to complete (1-3 minutes)
3. You'll see "Success" when done

### 3.5 Access your site

Your app is now live at:
```
https://svg-panel-generator.pages.dev
```

(The URL uses your project name. If you chose a different name, the URL will be different.)

---

## Step 4: Custom Domain (Optional)

If you want to use your own domain (e.g., `tools.yourcompany.com`):

### 4.1 Add custom domain in Cloudflare

1. In your Pages project, click **Custom domains**
2. Click **Set up a custom domain**
3. Enter your domain (e.g., `tools.yourcompany.com`)
4. Click **Continue**

### 4.2 Update DNS

Cloudflare will show you DNS records to add. If your domain is NOT managed by Cloudflare:

1. Go to your domain registrar (GoDaddy, Namecheap, etc.)
2. Add a **CNAME** record:
   - Name: `tools` (or whatever subdomain you want)
   - Value: `svg-panel-generator.pages.dev`
   - TTL: Auto or 1 hour

3. Wait 1-24 hours for DNS to propagate

If your domain IS managed by Cloudflare, it configures automatically.

---

## Step 5: Making Updates

Whenever you change the code:

### 5.1 Test locally

```bash
npm run build
npm run preview
```

### 5.2 Push to GitHub

```bash
git add .
git commit -m "Description of changes"
git push
```

### 5.3 Automatic deployment

Cloudflare automatically detects the push and rebuilds your site. Check the **Deployments** tab in Cloudflare Pages to see the status.

---

## Troubleshooting

### "npm not found" or "git not found"
- Make sure Node.js and Git are installed
- Close and reopen your terminal after installing

### Build fails in Cloudflare
- Check the build logs in Cloudflare Pages
- Common issues:
  - Missing `node_modules` - make sure `package.json` is correct
  - TypeScript errors - run `npm run build` locally first

### "Permission denied" when pushing to GitHub
- Use a Personal Access Token instead of password
- Or set up SSH keys: https://docs.github.com/en/authentication/connecting-to-github-with-ssh

### Files aren't being read
- Drag and drop works in Chrome, Edge, Firefox, and Safari
- Make sure you're dropping a folder, not individual files
- The folder must contain `.svg` files (case-insensitive)

---

## Security Notes

This is a **100% client-side application**:
- All SVG processing happens in the user's browser
- No files are ever uploaded to any server
- Cloudflare Pages only serves static HTML/CSS/JS files
- User data never leaves their computer

---

## Cost

- **Cloudflare Pages**: Free for unlimited sites, 500 builds/month
- **GitHub**: Free for private repos
- **Your domain**: Whatever you pay for it (optional)

---

## Summary

1. `npm install` - Install dependencies
2. `npm run build` - Build the app
3. Push to GitHub
4. Connect to Cloudflare Pages
5. Your app is live!

The app will automatically update whenever you push new code to GitHub.
