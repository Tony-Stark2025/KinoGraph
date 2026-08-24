# KinoGraph

KinoGraph converts short videos into stylized graphic-novel panel sequences and exports them as PDF.

## Productionization baseline included

This version adds:

- Product tiers (`Free`, `Pro`, `Team`) with explicit limits and export quality
- Hero onboarding target: **content creators and social marketers**
- Quality bar standards (supported MIME types, processing target, consistency expectation)
- Authenticated API flow (register/login)
- Subscription + usage metering APIs and UI
- Entitlement enforcement on analyze, stylize, and export operations
- Server-side Gemini execution via async jobs with retries + idempotency keys
- Signed artifact URLs with expiration for generated image retrieval
- Basic security/reliability middleware (strict validation, rate limiting, audit logging)

## Stack

- React 19 + Vite
- Express server (`server.ts`)
- Gemini models via `@google/genai`
- jsPDF export generation

## Environment variables

Create `.env.local` (or equivalent runtime env):

- `GEMINI_API_KEY` (required) - Gemini API access, server-side only
- `RESEND_API_KEY` (optional unless using feedback endpoint)
- `FEEDBACK_EMAIL_TO` (optional, default support recipient)
- `PORT` (optional, defaults to 3000)

## Run locally

1. Install dependencies:
   `npm install`
2. Set required environment variables.
3. Start app:
   `npm run dev`

## API capabilities overview

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/product/config`
- `GET /api/billing/usage`, `GET /api/billing/invoices`, `POST /api/billing/subscribe`, `POST /api/billing/cancel`
- `POST /api/jobs/analyze`, `POST /api/jobs/stylize`, `GET /api/jobs/:jobId`
- `POST /api/exports/consume`
- `GET /api/artifacts/:artifactId?token=...`

## Notes

- Current persistence is in-memory for this repository implementation (suitable for prototyping, not durable production storage).
- For full production rollout, connect the same APIs to persistent database, queue, and object storage providers.
