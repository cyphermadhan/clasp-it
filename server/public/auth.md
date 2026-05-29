# Clasp-it Authentication

## Auth method
Bearer token (API key) in the Authorization header.

```
Authorization: Bearer cit_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Getting a key
1. POST /auth/signup with `{ "email": "you@example.com", "deviceId": "unique-id" }`
2. Click the magic link sent to your email
3. Poll GET /auth/poll/:deviceId until verified — response includes your API key

## MCP setup
```bash
claude mcp add --scope user --transport http clasp-it https://claspit.dev/mcp --header "Authorization: Bearer YOUR_API_KEY"
```

## Rate limits
- Free: 10 picks/day
- Pro: unlimited

## Endpoints requiring auth
All endpoints except /auth/signup, /auth/verify/:token, /auth/poll/:deviceId, and /health.
