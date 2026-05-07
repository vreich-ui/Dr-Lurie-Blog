# 🚀 AstroWind

<img src="https://raw.githubusercontent.com/arthelokyo/.github/main/resources/astrowind/lighthouse-score.png" align="right"
     alt="AstroWind Lighthouse Score" width="100" height="358">

🌟 _Most *starred* & *forked* Astro theme in 2022, 2023 & 2024_. 🌟

**AstroWind** is a free and open-source template to make your website using **[Astro 5.0](https://astro.build/) + [Tailwind CSS](https://tailwindcss.com/)**. Ready to start a new project and designed taking into account web best practices.

- ✅ **Production-ready** scores in **PageSpeed Insights** reports.
- ✅ Integration with **Tailwind CSS** supporting **Dark mode** and **_RTL_**.
- ✅ **Fast and SEO friendly blog** with automatic **RSS feed**, **MDX** support, **Categories & Tags**, **Social Share**, ...
- ✅ **Image Optimization** (using new **Astro Assets** and **Unpic** for Universal image CDN).
- ✅ Generation of **project sitemap** based on your routes.
- ✅ **Open Graph tags** for social media sharing.
- ✅ **Analytics** built-in Google Analytics, and Splitbee integration.

<br>

![AstroWind Theme Screenshot](https://raw.githubusercontent.com/arthelokyo/.github/main/resources/astrowind/screenshot-astrowind-1.0.png)

[![arthelokyo](https://custom-icon-badges.demolab.com/badge/made%20by%20-arthelokyo-556bf2?style=flat-square&logo=arthelokyo&logoColor=white&labelColor=101827)](https://github.com/arthelokyo)
[![License](https://img.shields.io/github/license/arthelokyo/astrowind?style=flat-square&color=dddddd&labelColor=000000)](https://github.com/arthelokyo/astrowind/blob/main/LICENSE.md)
[![Maintained](https://img.shields.io/badge/maintained%3F-yes-brightgreen.svg?style=flat-square)](https://github.com/arthelokyo)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg?style=flat-square)](https://github.com/arthelokyo/astrowind#contributing)
[![Known Vulnerabilities](https://snyk.io/test/github/arthelokyo/astrowind/badge.svg?style=flat-square)](https://snyk.io/test/github/arthelokyo/astrowind)
[![Stars](https://img.shields.io/github/stars/arthelokyo/astrowind.svg?style=social&label=stars&maxAge=86400&color=ff69b4)](https://github.com/arthelokyo/astrowind)
[![Forks](https://img.shields.io/github/forks/arthelokyo/astrowind.svg?style=social&label=forks&maxAge=86400&color=ff69b4)](https://github.com/arthelokyo/astrowind)

<br>

<details open>
<summary>Table of Contents</summary>

- [Demo](#demo)
- [Upcoming: AstroWind 2.0 – We Need Your Vision!](#-upcoming-astrowind-20--we-need-your-vision)
- [TL;DR](#tldr)
- [Getting started](#getting-started)
  - [Project structure](#project-structure)
  - [Commands](#commands)
  - [Configuration](#configuration)
  - [Deploy](#deploy)
- [Frequently Asked Questions](#frequently-asked-questions)
- [Related Projects](#related-projects)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)
- [License](#license)

</details>

<br>

## Demo

📌 [https://astrowind.vercel.app/](https://astrowind.vercel.app/)

<br>

## 🔔 Upcoming: AstroWind 2.0 – We Need Your Vision!

We're embarking on an exciting journey with **AstroWind 2.0**, and we want you to be a part of it! We're currently taking the first steps in developing this new version and your insights are invaluable. Join the discussion and share your feedback, ideas, and suggestions to help shape the future of **AstroWind**. Let's make **AstroWind 2.0** even better, together!

[Share Your Feedback in Our Discussion!](https://github.com/arthelokyo/astrowind/discussions/392)

<br>

## TL;DR

```shell
npm create astro@latest -- --template arthelokyo/astrowind
```

## Getting started

**AstroWind** tries to give you quick access to creating a website using [Astro 5.0](https://astro.build/) + [Tailwind CSS](https://tailwindcss.com/). It's a free theme which focuses on simplicity, good practices and high performance.

Very little vanilla javascript is used only to provide basic functionality so that each developer decides which framework (React, Vue, Svelte, Solid JS...) to use and how to approach their goals.

In this version the template supports all the options in the `output` configuration, `static`, `hybrid` and `server`, but the blog only works with `prerender = true`. We are working on the next version and aim to make it fully compatible with SSR.

### Project structure

Inside **AstroWind** template, you'll see the following folders and files:

```
/
├── public/
│   ├── _headers
│   └── robots.txt
├── src/
│   ├── assets/
│   │   ├── favicons/
│   │   ├── images/
│   │   └── styles/
│   │       └── tailwind.css
│   ├── components/
│   │   ├── blog/
│   │   ├── common/
│   │   ├── ui/
│   │   ├── widgets/
│   │   │   ├── Header.astro
│   │   │   └── ...
│   │   ├── CustomStyles.astro
│   │   ├── Favicons.astro
│   │   └── Logo.astro
│   ├── content/
│   │   ├── post/
│   │   │   ├── post-slug-1.md
│   │   │   ├── post-slug-2.mdx
│   │   │   └── ...
│   │   └-- config.ts
│   ├── layouts/
│   │   ├── Layout.astro
│   │   ├── MarkdownLayout.astro
│   │   └── PageLayout.astro
│   ├── pages/
│   │   ├── [...blog]/
│   │   │   ├── [category]/
│   │   │   ├── [tag]/
│   │   │   ├── [...page].astro
│   │   │   └── index.astro
│   │   ├── index.astro
│   │   ├── 404.astro
│   │   ├-- rss.xml.ts
│   │   └── ...
│   ├── utils/
│   ├── config.yaml
│   └── navigation.js
├── package.json
├── astro.config.ts
└── ...
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory if they do not require any transformation or in the `assets/` directory if they are imported directly.

[![Edit AstroWind on CodeSandbox](https://codesandbox.io/static/img/play-codesandbox.svg)](https://githubbox.com/arthelokyo/astrowind/tree/main) [![Open in Gitpod](https://svgshare.com/i/xdi.svg)](https://gitpod.io/?on=gitpod#https://github.com/arthelokyo/astrowind) [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/arthelokyo/astrowind)

> 🧑‍🚀 **Seasoned astronaut?** Delete this file `README.md`. Update `src/config.yaml` and contents. Have fun!

<br>

### Commands

All commands are run from the root of the project, from a terminal:

| Command             | Action                                             |
| :------------------ | :------------------------------------------------- |
| `npm install`       | Installs dependencies                              |
| `npm run dev`       | Starts local dev server at `localhost:4321`        |
| `npm run build`     | Build your production site to `./dist/`            |
| `npm run preview`   | Preview your build locally, before deploying       |
| `npm run check`     | Check your project for errors                      |
| `npm run fix`       | Run Eslint and format codes with Prettier          |
| `npm run astro ...` | Run CLI commands like `astro add`, `astro preview` |

<br>

### Configuration

Basic configuration file: `./src/config.yaml`

```yaml
site:
  name: 'Example'
  site: 'https://example.com'
  base: '/' # Change this if you need to deploy to Github Pages, for example
  trailingSlash: false # Generate permalinks with or without "/" at the end

  googleSiteVerificationId: false # Or some value,

# Default SEO metadata
metadata:
  title:
    default: 'Example'
    template: '%s — Example'
  description: 'This is the default meta description of Example website'
  robots:
    index: true
    follow: true
  openGraph:
    site_name: 'Example'
    images:
      - url: '~/assets/images/default.png'
        width: 1200
        height: 628
    type: website
  twitter:
    handle: '@twitter_user'
    site: '@twitter_user'
    cardType: summary_large_image

i18n:
  language: en
  textDirection: ltr

apps:
  blog:
    isEnabled: true # If the blog will be enabled
    postsPerPage: 6 # Number of posts per page

    post:
      isEnabled: true
      permalink: '/blog/%slug%' # Variables: %slug%, %year%, %month%, %day%, %hour%, %minute%, %second%, %category%
      robots:
        index: true

    list:
      isEnabled: true
      pathname: 'blog' # Blog main path, you can change this to "articles" (/articles)
      robots:
        index: true

    category:
      isEnabled: true
      pathname: 'category' # Category main path /category/some-category, you can change this to "group" (/group/some-category)
      robots:
        index: true

    tag:
      isEnabled: true
      pathname: 'tag' # Tag main path /tag/some-tag, you can change this to "topics" (/topics/some-category)
      robots:
        index: false

    isRelatedPostsEnabled: true # If a widget with related posts is to be displayed below each post
    relatedPostsCount: 4 # Number of related posts to display

analytics:
  vendors:
    googleAnalytics:
      id: null # or "G-XXXXXXXXXX"

ui:
  theme: 'system' # Values: "system" | "light" | "dark" | "light:only" | "dark:only"
```

<br>

#### Customize Design

To customize Font families, Colors or more Elements refer to the following files:

- `src/components/CustomStyles.astro`
- `src/assets/styles/tailwind.css`

### Deploy

#### Deploy to production (manual)

You can create an optimized production build with:

```shell
npm run build
```

Now, your website is ready to be deployed. All generated files are located at
`dist` folder, which you can deploy the folder to any hosting service you
prefer.

#### Deploy to Netlify

Clone this repository on your own GitHub account and deploy it to Netlify:

[![Netlify Deploy button](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/arthelokyo/astrowind)

#### Deploy to Vercel

Clone this repository on your own GitHub account and deploy to Vercel:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Farthelokyo%2Fastrowind)

<br>

## Frequently Asked Questions

- Why?
-
-

<br>

## Related projects

- [TailNext](https://tailnext.vercel.app/) - Free template using Next.js 14 and Tailwind CSS with the new App Router.
- [Qwind](https://qwind.pages.dev/) - Free template to make your website using Qwik + Tailwind CSS.

## Contributing

If you have any ideas, suggestions or find any bugs, feel free to open a discussion, an issue or create a pull request.
That would be very useful for all of us and we would be happy to listen and take action.

## Acknowledgements

Initially created by **Arthelokyo** and maintained by a community of [contributors](https://github.com/arthelokyo/astrowind/graphs/contributors).

## License

**AstroWind** is licensed under the MIT license — see the [LICENSE](./LICENSE.md) file for details.

## Clerk authentication on Netlify

This site uses Clerk for public member authentication through the official `@clerk/astro` SDK. Netlify Identity is not used for the public login system; the existing Decap CMS admin screen may still rely on Netlify Identity/git-gateway only for content-management access.

The Astro build runs in `hybrid` output mode with the Netlify adapter so normal marketing/blog pages can remain prerendered while auth pages and `/members` are rendered on the server. Server rendering is required for `/members` because Clerk middleware must redirect signed-out users before protected content is served.

### Required environment variables

Set these in `.env` for local development and in **Netlify → Site configuration → Environment variables** for production:

```bash
PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_or_pk_live_...
CLERK_SECRET_KEY=sk_test_or_sk_live_...
```

`PUBLIC_CLERK_PUBLISHABLE_KEY` is safe for browser use. `CLERK_SECRET_KEY` is server-only and must not be embedded in Astro pages, public JavaScript, or any client-side bundle.

For Netlify Functions that verify session tokens without an extra network call, you may also set Clerk's JWKS public key from the Clerk Dashboard:

```bash
CLERK_JWT_KEY='-----BEGIN PUBLIC KEY-----...-----END PUBLIC KEY-----'
CLERK_AUTHORIZED_PARTIES=https://drluriescience.netlify.app,http://localhost:4321
```

`CLERK_JWT_KEY` is optional when `CLERK_SECRET_KEY` is available. `CLERK_AUTHORIZED_PARTIES` is recommended so server-side verification accepts only tokens minted for the expected frontend origins.

### Local development

1. Create a Clerk application in the Clerk Dashboard.
2. Add these Clerk redirect URLs in the Dashboard:
   - Sign-in URL: `http://localhost:4321/sign-in`
   - Sign-up URL: `http://localhost:4321/sign-up`
   - After sign-in URL: `http://localhost:4321/members`
   - After sign-up URL: `http://localhost:4321/members`
   - After sign-out URL: `http://localhost:4321/`
3. Create `.env` locally and add `PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
4. Run the site:

```bash
npm install
npm run dev
```

Visit `/sign-in`, `/sign-up`, and `/members`. Signed-out visitors to `/members` are redirected by `src/middleware.ts` before the protected server-rendered page returns content.

### Netlify deployment

1. In Clerk, add production URLs for `https://drluriescience.netlify.app`:
   - Sign-in URL: `https://drluriescience.netlify.app/sign-in`
   - Sign-up URL: `https://drluriescience.netlify.app/sign-up`
   - After sign-in URL: `https://drluriescience.netlify.app/members`
   - After sign-up URL: `https://drluriescience.netlify.app/members`
   - After sign-out URL: `https://drluriescience.netlify.app/`
2. Add `PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to Netlify environment variables. Use Clerk production keys for the production Netlify domain to avoid preview/development-domain redirect loops.
3. Optionally add `CLERK_JWT_KEY` and `CLERK_AUTHORIZED_PARTIES` for the protected Netlify Function boundary.
4. Deploy with the existing Netlify build command:

```bash
npm run build
```

The Netlify redirects in `netlify.toml` keep Clerk account-route deep links resolving to the correct Astro page shell.

### Static, hybrid, and server output tradeoffs

- `static` output is fastest and simplest, but it cannot protect `/members` before content is served because there is no server-rendered request boundary for that page.
- `hybrid` output is the chosen setup: public pages stay prerendered, while `prerender = false` auth/member pages run on Netlify serverless functions where Clerk middleware can validate sessions. The Netlify adapter is configured with edge middleware disabled because Clerk documents Netlify Edge middleware caveats for Astro.
- `server` output would render every route on the server. That is useful for app-heavy sites, but it is unnecessary here and would give up some static-site performance for public education/marketing pages.

### Future paid-member checks with Stripe

The `/members` page is a protected member shell, but do not rely on frontend hiding for premium content. Private or paid content must be served through a server-side boundary such as a Netlify Function or Edge Function.

The starter function at `netlify/functions/member-content.ts` demonstrates the intended pattern:

1. Read the Clerk session token from `Authorization: Bearer <token>` or the `__session` cookie.
2. Validate the Clerk token server-side with Clerk's official `verifyToken()` helper in `netlify/lib/clerk-session.ts`.
3. Use the verified Clerk user ID (`claims.sub`) to look up a Stripe customer, subscription, or entitlement.
4. Return paid content only when both the Clerk session and Stripe entitlement are valid.

Frontend code may request paid content after sign-in, but the function must be the place where Clerk and Stripe are trusted.
