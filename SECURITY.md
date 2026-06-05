# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Email the maintainer or use GitHub private vulnerability reporting if it is enabled for this repository. Include:

- A short description of the issue
- Affected files or routes
- Reproduction steps
- Potential impact
- Any suggested fix

## Secrets and Data

This project should not contain production credentials or private operational data.

Do not commit:

- OAuth client secrets
- API keys
- Supabase service-role keys
- Database passwords
- Customer, sales, inventory, or logistics exports
- Internal hostnames, IP addresses, or table names

Use `.env.local` for local development and deployment secret managers for hosted environments.
