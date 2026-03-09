<!--
   Copyright 2026 UCP Authors

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
-->

# Cymbal Retail Agent

Example agent implementing A2A Extension for UCP

### Pre-requisites:

1. Python 3.13
2. UV
3. Gemini API Key (The agent uses Gemini model to generate responses)

## Quick Start

1. Run `uv sync`
2. Copy env.example to .env and update it with relevant Gemini API key.
3. Run `uv run business_agent`
4. This starts the Cymbal Retail Agent on port 10999. You can verify by accessing
the agent card at http://localhost:10999/.well-known/agent-card.json

## Environment Variables

The agent reads environment variables at startup (via `python-dotenv`). You
can create a `.env` file in the `business_agent` directory, or export them in
your shell/CI environment. A sample `.env.example` is provided next to the
code; **never commit your real `.env` file**.

Example `.env` contents:

```ini
# required by the Gemini model agent
GOOGLE_API_KEY=your-google-api-key-here

# Stripe configuration (test mode)
# You can also set BUSINESS_AGENT_USE_STRIPE=1 but a key is needed for actual
# API calls.
STRIPE_API_KEY=sk_test_XXXXXXXXXXXXXXXXXXXX
STRIPE_PUBLISHABLE_KEY=pk_test_XXXXXXXXXXXXXXXXXXXX  # optional for frontend
```

Keep the `.env` file out of version control (add it to `.gitignore` if needed).

