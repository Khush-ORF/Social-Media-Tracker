# Collection Trigger Worker

GitHub Pages is static, so it cannot securely trigger GitHub Actions by itself. This Cloudflare Worker holds the GitHub token as a secret and exposes a small POST endpoint for the dashboard button.

## Deploy

1. Create a Cloudflare Worker.
2. Paste `collect-trigger.js` into the Worker.
3. Create a fine-grained GitHub token with access to `Khush-ORF/Social-Media-Tracker` and permission to run Actions/workflows.
4. Add the token as a Worker secret named:

```text
GITHUB_TOKEN
```

5. Deploy the Worker.
6. Copy the Worker URL.
7. Update `public/trigger-config.json`:

```json
{
  "collectEndpoint": "https://your-worker-name.your-subdomain.workers.dev"
}
```

8. Commit and push. The website button will then trigger the GitHub Actions collection workflow.

## Request Shape

```json
{
  "platform": "X"
}
```

Use an empty platform to run all platforms.

