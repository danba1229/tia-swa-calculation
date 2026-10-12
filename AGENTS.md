# Change and release workflow

- Make changes on a separate branch and open a pull request against `main` after validation.
- Wait for the user's explicit approval of the PR before merging or pushing changes to `main`, or deploying to production. Do not enable automatic merge before that approval.
- After approval, merge the approved changes and verify the production deployment through the existing GitHub/Vercel workflow.
- Report the PR and validation results while approval is pending.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
