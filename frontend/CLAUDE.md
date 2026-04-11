# Frontend CLAUDE.md

Frontend-specific guidance for the Grainwatch PWA. See root `CLAUDE.md` for shared conventions.

## Tech Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Build Tool | Vite | 7.3+ |
| Framework | React | 19.2+ |
| Language | TypeScript | 5.9+ |
| Styling | Tailwind CSS | 4.2+ (CSS-first) |
| UI Components | shadcn/ui style | - |
| PWA | vite-plugin-pwa | 1.2+ (Workbox) |
| Router | React Router | 7.13+ |
| HTTP | Axios | 1.13+ |
| State | React Context | - |

## Project Structure

```
frontend/
├── public/                 # Static assets (PWA icons, favicon)
├── src/
│   ├── api/               # Backend API client
│   │   ├── client.ts      # Axios instance with auth interceptors
│   │   ├── auth.ts        # Authentication API
│   │   ├── stocks.ts      # Stocks API
│   │   └── index.ts       # Central exports
│   ├── components/
│   │   ├── ui/            # shadcn/ui style components
│   │   ├── Header.tsx     # App header with logout
│   │   └── StockCard.tsx  # Stock display card
│   ├── contexts/
│   │   └── AuthContext.tsx # Authentication state
│   ├── lib/
│   │   └── utils.ts       # Utility functions (cn)
│   ├── pages/
│   │   ├── LoginPage.tsx  # Login form
│   │   └── HomePage.tsx   # Stock list
│   ├── types/
│   │   └── api.ts         # TypeScript types
│   ├── App.tsx            # Routes and providers
│   ├── main.tsx           # Entry point
│   └── index.css          # Tailwind + CSS variables
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Path Aliases

- `@/*` maps to `./src/*` (configured in tsconfig.json and vite.config.ts)

## Customising Tailwind Theme (v4)

Tailwind 4 uses CSS-first configuration via `@theme` in `src/index.css`. No `tailwind.config.js` needed.

```css
@theme {
  --color-brand: hsl(220 90% 50%);
  --radius-xl: 1rem;
}
```

## Authentication

- JWT-based, token stored in localStorage (`grainwatch_token`)
- Automatic token injection via Axios interceptor
- `AuthContext` provides `useAuth()` hook

## PWA Features

- Offline caching via Service Worker (Workbox)
- Installable on mobile devices
- API responses cached with NetworkFirst strategy
- Auto-update on new deployments

## Running

```bash
# From monorepo root
npm run dev:frontend

# Or from this directory
npm run dev          # http://localhost:5173
npm run build        # Production build
npm run preview      # Preview production build
npm run lint         # Linting
```

## Environment Variables

```bash
# .env or .env.local
VITE_API_BASE_URL=https://your-backend-url.com/api/v1
```

For development, defaults to `http://localhost:3000/api/v1`.

## Common Tasks

### Adding a new page
1. Create component in `src/pages/`
2. Add route in `src/App.tsx`
3. Wrap with `ProtectedRoute` if authentication required

### Adding a new API endpoint
1. Add types to `src/types/api.ts`
2. Add API function to `src/api/` (existing file or new)
3. Export from `src/api/index.ts`

### Adding a shadcn/ui component
1. Create component in `src/components/ui/`
2. Use `cn()` from `@/lib/utils` for class merging
3. Follow existing patterns (forwardRef, variants)
