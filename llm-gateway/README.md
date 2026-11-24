# YAH LLM Gateway

Standalone multi-provider LLM gateway for YAH. It accepts YAH's canonical chat request, calls any supported provider, and emits one canonical event stream regardless of the provider's native protocol.

The provider catalog is generated from `https://models.dev/api.json` — the same catalog OpenCode/OpenChamber use — and contains **326 providers**. Protocol adapters normalize the provider-specific wire formats; everything else uses the OpenAI-compatible adapter.

## Run

```bash
cd llm-gateway
npm start
# yah-llm-gateway listening on http://127.0.0.1:8790
```

Or use the CLI directly:

```bash
node bin/yah-llm-gateway.js providers
node bin/yah-llm-gateway.js providers anthropic
node bin/yah-llm-gateway.js models
node bin/yah-llm-gateway.js chat \
  --task chat \
  --message "Say hello"
```

Set keys with provider environment variables (for example `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) or pass `apiKey` in the request.

## Model exposure and task routing

YAH only shows the models listed in `config.json`. A model is exposed when it has an `id`, `label`, `provider` and `model`. The gateway falls back to `config.example.json` when `config.json` does not exist yet; saving from YAH creates `config.json`. Example:

```json
{
  "models": [
    {
      "id": "fast",
      "label": "快速",
      "description": "日常对话、信息收集、测试和文档",
      "provider": "opencode-go",
      "model": "deepseek-v4.1-flash",
      "apiKeyFromRequest": true
    },
    {
      "id": "deep",
      "label": "深度",
      "provider": "opencode-go",
      "model": "deepseek-v4-pro",
      "apiKeyFromRequest": true
    }
  ],
  "routes": {
    "chat": "fast",
    "manager": "deep",
    "lead": "deep",
    "research": "fast",
    "programmer": "deep",
    "tester": "fast",
    "writer": "fast",
    "reviewer": "deep"
  },
  "defaultModel": "fast"
}
```

Task names are `chat`, `manager`, `lead`, `research`, `programmer`, `tester`, `writer` and `reviewer`. YAH sends the task that matches the active agent profile, so each role can use a different model. A request with an explicit `model` alias overrides the task route; a request with no alias uses the route for its task, then `defaultModel`.

`apiKeyFromRequest` lets the gateway use the `apiKey` sent by YAH. OpenCode and OpenCode Go models always accept the request key. Other providers read their own environment variables (for example `OPENROUTER_API_KEY`) unless the model opts in.

YAH's Settings panel edits the exposed model list and the task routes through `GET/PUT /v1/config`. The composer model picker only lists these exposed models. Selecting a model pins it to that conversation; leaving it alone follows the task route.

```bash
node bin/yah-llm-gateway.js models
node bin/yah-llm-gateway.js chat --task programmer --message "Review this diff"
```

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Health, catalog size and catalog source |
| `GET` | `/v1/providers?q=` | Full provider catalog with protocol and env names |
| `GET` | `/v1/models` | Exposed models, task routes and default model |
| `GET` | `/v1/models?provider=deepseek` | Proxy the provider's model list when it exposes one |
| `GET` | `/v1/config` | Exposed models, task routes and default model |
| `PUT` | `/v1/config` | Replace exposed models and task routes |
| `POST` | `/v1/chat` | Canonical YAH request, SSE stream of YAH events |
| `POST` | `/v1/chat/complete` | Same request, returns the final message as JSON |

### YAH canonical request

```json
{
  "model": "fast",
  "task": "programmer",
  "provider": "openrouter",
  "apiKey": "optional; otherwise use the provider env var",
  "sessionId": "optional stable session id; OpenCode Go uses x-opencode-session",
  "baseURL": "optional override",
  "protocol": "optional force: openai-chat | openai-responses | anthropic-messages | gemini | cohere-chat | azure-openai | bedrock-converse",
  "messages": [
    { "role": "system", "content": "You are YAH." },
    { "role": "user", "content": "Inspect the project" },
    {
      "role": "assistant",
      "content": "I will read it.",
      "reasoning": "The user wants a repository inspection.",
      "toolCalls": [
        { "id": "call_1", "name": "read", "arguments": { "path": "README.md" } }
      ]
    },
    { "role": "tool", "toolCallId": "call_1", "name": "read", "content": "# Project" }
  ],
  "tools": [
    {
      "name": "read",
      "description": "Read a file",
      "parameters": {
        "type": "object",
        "properties": { "path": { "type": "string" } },
        "required": ["path"]
      }
    }
  ],
  "toolChoice": "auto",
  "temperature": 0.2,
  "maxTokens": 8192,
  "reasoningEffort": "high",
  "stream": true
}
```

### YAH canonical events

`POST /v1/chat` returns SSE frames:

```text
event: start
data: {"type":"start","provider":"deepseek","model":"deepseek-chat","at":"..."}

event: text.delta
data: {"type":"text.delta","text":"Hello"}

event: reasoning.delta
data: {"type":"reasoning.delta","text":"Thinking..."}

event: tool_call.start
data: {"type":"tool_call.start","index":0,"id":"call_1","name":"read"}

event: tool_call.delta
data: {"type":"tool_call.delta","index":0,"argumentsDelta":"{\"path\":"}

event: tool_call.end
data: {"type":"tool_call.end","index":0,"id":"call_1","name":"read","arguments":"{\"path\":\"README.md\"}"}

event: usage
data: {"type":"usage","usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15,"cachedInputTokens":0,"reasoningTokens":0}}

event: done
data: {"type":"done","message":{"role":"assistant","content":"Hello","reasoning":"","toolCalls":[]},"finishReason":"stop","usage":{...}}

data: [DONE]
```

Errors are emitted as `event: error` with `{ code, message, status, details }`.

## Protocols

| Protocol | Providers / notes |
| --- | --- |
| `openai-chat` | OpenAI-compatible providers: DeepSeek, OpenRouter, Groq, Cerebras, xAI, Together, DeepInfra, Fireworks, Baseten, DigitalOcean, Alibaba, Moonshot, Z.AI, MiniMax, Mistral, Venice, OpenCode, OpenCode Go, Vercel, Cloudflare, most gateways and local servers |
| `openai-responses` | OpenAI, and providers exposing the Responses API |
| `anthropic-messages` | Anthropic, MiniMax Anthropic mode, Moonshot Anthropic mode, Vertex Anthropic mode |
| `gemini` | Google AI Studio and Google Vertex |
| `cohere-chat` | Cohere v2 |
| `azure-openai` | Azure OpenAI deployments (`baseURL` + `apiVersion` + `deployment`) |
| `bedrock-converse` | Amazon Bedrock Converse streaming with AWS SigV4 |

The catalog also contains media-only providers from models.dev; the chat gateway is for text/tool models. Providers without a known default endpoint accept a custom `baseURL`, so Ollama, LM Studio, LiteLLM, vLLM, campus gateways and private OpenAI-compatible servers work without code changes.

### Provider-specific setup

- **OpenAI / OpenCode Go**: `OPENAI_API_KEY` / `OPENCODE_API_KEY`
- **Anthropic**: `ANTHROPIC_API_KEY` (sent as `x-api-key`)
- **Google AI Studio**: `GOOGLE_GENERATIVE_AI_API_KEY` (sent as `x-goog-api-key`)
- **Google Vertex**: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and `GOOGLE_ACCESS_TOKEN` or `apiKey`
- **Amazon Bedrock**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`, `AWS_REGION`
- **Azure**: `baseURL` of the Azure resource, `apiKey`, optional `apiVersion` and `deployment`
- **GitHub Copilot**: `GITHUB_COPILOT_TOKEN` or `apiKey`; Copilot headers are added automatically
- **Custom / local**: pass `provider: "custom"`, `baseURL`, `protocol: "openai-chat"`, and optionally `apiKey`

## YAH integration

The gateway is independent of the YAH Electron app. YAH can call the HTTP API directly or use the bundled client:

```js
const { streamYahChat } = require('./llm-gateway/src/client');

await streamYahChat({
  endpoint: 'http://127.0.0.1:8790',
  request: {
    provider: 'deepseek',
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: 'Hello' }],
  },
  onEvent(event) {
    if (event.type === 'text.delta') process.stdout.write(event.text);
  },
});
```

Or embed the gateway in-process:

```js
const { createGateway } = require('./llm-gateway');

const gateway = createGateway();
for await (const event of gateway.stream({
  provider: 'openai',
  model: 'gpt-5',
  messages: [{ role: 'user', content: 'Hello' }],
})) {
  console.log(event);
}
```

## Layout

```text
llm-gateway/
  bin/yah-llm-gateway.js      CLI: serve / providers / chat
  src/catalog.js              models.dev provider catalog + protocol resolution
  src/providers.json          generated provider catalog (326 providers)
  src/gateway.js              routing, auth, URL building, event queue
  src/events.js               YAH canonical events and usage normalization
  src/transport.js            fetch, SSE, NDJSON and error handling
  src/protocols/              OpenAI Chat, OpenAI Responses, Anthropic, Gemini,
                              Cohere, Azure, Bedrock
  src/server.js               HTTP server
  src/client.js               YAH client helper
  test/                       catalog, protocol and HTTP tests
```

## Refresh the provider catalog

The catalog is generated from models.dev. Refresh it when OpenChamber/OpenCode adds or renames a provider:

```bash
node llm-gateway/scripts/refresh-providers.js
```

## Tests

```bash
cd llm-gateway
npm test
```
