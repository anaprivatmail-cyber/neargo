# NearGo Copilot Instructions

## Project Overview
NearGo is a Slovenian PWA (Progressive Web App) for finding nearby events and services. It's built as a static-first Netlify application with serverless functions, using Supabase as the primary database and integrating external APIs like Ticketmaster and Eventbrite.

## Architecture Patterns

### Frontend Structure
- **Static HTML entry points**: `index.html`, `my.html`, `scan.html`, etc. serve specific app sections
- **Modular JS loading**: `assets/main.js` dynamically loads HTML partials and initializes the app
- **Component-based assets**: Files in `assets/` handle specific features (map, search, payments, etc.)
- **No build step**: Direct file serving with cache-busting via `window.__BUILD_TS__`

### Backend (Netlify Functions)
- **Function naming**: `netlify/functions/[feature].js` pattern (e.g., `provider-list.js`, `scan.js`)
- **Redirects in `netlify.toml`**: Maps `/api/*` paths to `/.netlify/functions/*`
- **Provider system**: `providers/` directory contains data source adapters (Supabase, external APIs)
- **Mixed module systems**: Functions use ES6 imports, providers use CommonJS requires

### Data Flow
1. **Event aggregation**: `providers/index.js` orchestrates multiple data sources
2. **Normalization**: Each provider transforms its data to a common schema
3. **Geographic filtering**: Built-in haversine distance calculations
4. **Caching**: Supabase Storage used for user-submitted events

## Key Development Patterns

### Error Handling
```javascript
// Standard function response pattern
const json = (data, status = 200) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  body: JSON.stringify(data)
});
```

### CORS Configuration
All API functions include CORS headers. Use the standard `CORS` object pattern found in existing functions.

### Frontend State Management
- Global state stored in closure variables (e.g., `GEO`, `currentPage` in `app-logic.js`)
- Panel system controlled via `showPanel()` function
- Local storage for theme and user preferences

### Geographic Features
- Leaflet.js for mapping functionality
- Coordinate validation using `safeNum()` helper
- Distance calculations via `haversineKm()` in `providers/types.js`

## Critical Files to Understand

- **`netlify.toml`**: API routing and deployment configuration
- **`assets/main.js`**: App initialization and HTML partial loading
- **`providers/index.js`**: Data source orchestration
- **`netlify/functions/provider-list.js`**: Main event listing API
- **`assets/app-logic.js`**: Core frontend logic and UI interactions

## Development Workflow

### Local Development
```bash
npm start  # Runs `netlify dev`
```

### Function Testing
Functions are accessible at `http://localhost:8888/.netlify/functions/[name]` during development.

### Environment Variables
Required in Netlify or `.env`:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Payment provider keys (Stripe, Apple, Google)
- Email service credentials (Brevo/SendGrid)

## Common Patterns to Follow

### Adding New Functions
1. Create in `netlify/functions/[name].js`
2. Add redirect rule in `netlify.toml`
3. Include CORS headers and error handling
4. Use the standard JSON response pattern

### Frontend Components
- Use the `$` selector helper for DOM queries
- Follow the existing panel show/hide pattern
- Implement proper cleanup for event listeners
- Use `debounce()` for input handlers

### Data Processing
- Always validate coordinates with `safeNum()`
- Use `trimLower()` for string normalization
- Follow the provider interface in `providers/types.js`
- Implement proper fallbacks for missing data

## Slovenian Context
- UI text is in Slovenian (labels, messages, formatting)
- Date/time formatting uses `sl-SI` locale
- Currency formatting in EUR with Slovenian conventions
- Address formatting follows European standards