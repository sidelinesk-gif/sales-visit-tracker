GPS-verified sales visit tracker with selfie capture, geofencing, and role-based dashboards.

## Setup

```bash
npm install
cp .env.example .env    # then edit .env with your values
npm start
```

Open http://localhost:3000

## Default Login

- **Email:** admin@company.com
- **Password:** admin123

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `SESSION_SECRET` | Secret for session cookies |
| `GOOGLE_MAPS_API_KEY` | Optional — falls back to manual lat/lng entry |
| `BASE_URL` | Used in CSV exports for selfie URLs |

## Roles

- **Admin** — manage users, clients, assignments; export all visits
- **Manager** — view team visits, filter, export CSV
- **Sales Rep** — log visits with GPS + selfie
