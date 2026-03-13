# R.E.A.L. SmartScan AI Engine

Consumer-facing AI deal scanner with embedded margin engine, BNPL/credit integration, and resale channel.

## Features

- **SmartScan** — Search any product, surfaces deals from 500+ retailers ranked by Deal Score
- **Margin Engine** — Per-category take-rate rules; customer sees savings, you control the spread
- **BNPL & Credit** — Affirm / Klarna / Sezzle / LendUp Micro partner stubs with referral fee tracking
- **Resale Channel** — AI price estimation, marketplace routing, tiered platform fees
- **Dashboard** — Savings analytics, deal history, deal score
- **Plans & Pricing** — Free / Pro ($9.99/mo) / Business ($499/mo) with revenue model breakdown

## Deploy to Vercel

### Option 1 — Vercel CLI
```bash
npm i -g vercel
vercel
```

### Option 2 — Vercel Dashboard
1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your GitHub repo
4. Framework: **Other** (static site)
5. Root directory: leave as `/`
6. Click **Deploy**

No build step required — pure static HTML/CSS/JS.

## Local Dev
```bash
npm run dev
# → http://localhost:3000
```

## Integration into real-pt.com

This is a standalone `public/index.html`. Options:
- **Subdomain**: Point `scan.real-pt.com` to this Vercel deployment
- **Iframe embed**: `<iframe src="https://your-deployment.vercel.app" />`
- **Route integration**: Copy `index.html` into your existing site as `/smartscan`

## Next Steps (Production)

| Feature | Integration |
|---|---|
| Live product search | Perplexity API / SerpAPI |
| Real pricing data | Rainforest API / PriceAPI |
| Payments | Stripe Connect |
| BNPL | Affirm SDK, Klarna On-Site Messaging |
| Micro-loans | LendUp / Possible Finance API |
| Auth & user accounts | Clerk / Supabase Auth |
| Transaction margin tracking | Custom backend (Node/Express + Postgres) |

Built with [Perplexity Computer](https://www.perplexity.ai/computer).
