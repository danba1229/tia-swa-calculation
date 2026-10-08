# Change and release workflow

- Make changes on a separate branch and open a pull request against `main` after validation.
- Wait for the user's explicit approval of the PR before merging or pushing changes to `main`, or deploying to production. Do not enable automatic merge before that approval.
- After approval, merge the approved changes and verify the production deployment through the existing GitHub/Vercel workflow.
- Report the PR and validation results while approval is pending.
