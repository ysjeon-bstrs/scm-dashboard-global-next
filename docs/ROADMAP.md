# Roadmap

## Near Term

- Add sample inventory and logistics datasets for local demos
- Add unit tests for data transforms and allocation logic
- Document source adapter contracts
- Remove remaining private deployment assumptions from examples

## Migration Work

- Port stable Python/Streamlit dashboard workflows into typed Next.js modules
- Keep business logic in `src/lib/scm-dashboard` instead of React components
- Add API route tests around filters, date handling, and source failures
- Build repeatable Excel import/export test fixtures

## Maintainer Automation

- Generate PR summaries for SCM logic changes
- Suggest tests for inventory and logistics calculations
- Draft release notes from merged pull requests
- Add security review prompts for source adapters and credential handling
