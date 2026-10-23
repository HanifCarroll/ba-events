# Security policy

## Supported code

Security fixes target the current `main` branch. There are no supported versioned releases yet; historical branches and archived plans are not maintained release lines.

## Report privately

Use GitHub's **Security → Report a vulnerability** on [this repository](https://github.com/HanifCarroll/ba-events/security/advisories/new). If that option is unavailable, email **hanif@hanifcarroll.com** with the subject “BA Eventos security report”.

Include the affected commit, relevant files, a minimal reproduction using synthetic data, and the expected impact. Do not put live keys, real user records, or exploit details in a public issue. Do not access other users' data, probe the hosted service, or run destructive or high-volume tests. Use an isolated local environment.

This is an independently maintained project; response times are not guaranteed. Please allow time to investigate and coordinate a fix before publishing details.

## Credentials and data

The repository is public for code inspection. Access to the hosted infrastructure, credentials, and user data remains restricted to authorized maintainers. Use synthetic fixtures for review and testing. Never commit credentials or expose a Supabase service-role key through a `PUBLIC_` variable.

If a real credential is committed, revoke or rotate it first, assess access, and coordinate removal from Git history and GitHub surfaces. Deleting it in a later commit alone does not remove the exposure. Automated secret scanning helps detect mistakes; it is not a security guarantee.

See [the chat trust boundary](docs/chat-trust-boundary.md) for the model's allowed tools and the server's validation responsibilities.
