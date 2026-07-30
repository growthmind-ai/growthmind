# Security

Growthmind handles customer session data, and its core privacy claims — no
PII in the stream, masking at capture, exclusions by construction — are only
as good as the scrutiny they get. Security reports are genuinely welcome.

## Reporting a vulnerability

Please **do not open a public issue**. Instead, either:

- use [GitHub's private vulnerability reporting](https://github.com/growthmind-ai/growthmind/security/advisories/new), or
- email **founders@growthmind.ai**

Include steps to reproduce and, if you have one, a suggested fix. We will
acknowledge reports promptly, keep you informed as a fix lands, and credit
reporters who want credit once it ships.

## Scope

- This repository (the app, SDK, worker, and published packages)
- The hosted service at growthmind.ai

Please do not test against production infrastructure in ways that degrade
service for others, and do not access data that is not yours — a proof of
concept against your own self-hosted instance (`docker compose up`) is always
in scope and always safe.

## What counts

Anything that breaks the product's stated guarantees is high-priority, in
particular:

- PII reaching the event stream or session recordings despite masking
- Cross-tenant access of any kind (findings, sessions, experiments, keys)
- Authentication or session weaknesses in the app or API
- The SDK capturing traffic it is documented to exclude

## Supported versions

Pre-release: only the latest `main` is supported. Once versioned releases
exist, this section will state the supported window.
