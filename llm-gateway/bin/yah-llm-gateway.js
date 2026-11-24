#!/usr/bin/env node
'use strict';

const { createServer } = require('../src/server');
const { createGateway } = require('../src/gateway');
const { listProviders } = require('../src/catalog');
const { loadConfig, publicModels } = require('../src/config');
const { VERSION } = require('../src/server');

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function help() {
  console.log(`yah-llm-gateway ${VERSION}

Usage:
  yah-llm-gateway serve [--port 8790] [--host 127.0.0.1] [--config config.json]
  yah-llm-gateway providers [--json] [query]
  yah-llm-gateway models [--json]
  yah-llm-gateway chat --model <alias> --message <text> [options]
  yah-llm-gateway chat --task <task> --message <text> [options]

Options:
  --system <text>        System prompt for chat
  --task <name>          Route by task: chat, manager, lead, research,
                         programmer, tester, writer, reviewer
  --provider <id>        Provider for unlisted/custom models
  --api-key <key>        Provider API key (or use the provider environment variable)
  --base-url <url>       Override the provider base URL
  --protocol <name>      Force a protocol: openai-chat, openai-responses,
                         anthropic-messages, gemini, cohere-chat, azure-openai,
                         bedrock-converse
  --config <file>        Gateway config file (default llm-gateway/config.json)
  --json                 Print the final message as JSON
  --allow-no-key         Allow keyless local endpoints
`);
}

async function serve(args) {
  const port = Number(args.port || process.env.YAH_LLM_GATEWAY_PORT || 8790);
  const host = String(args.host || process.env.YAH_LLM_GATEWAY_HOST || '127.0.0.1');
  const server = createServer({
    configFile: args.config ? String(args.config) : undefined,
    defaultProvider: String(
      args['default-provider'] || process.env.YAH_LLM_GATEWAY_PROVIDER || ''
    ) || undefined,
  });
  server.listen(port, host, () => {
    console.log(`yah-llm-gateway listening on http://${host}:${port}`);
    console.log(`providers: ${listProviders().length}`);
  });
}

function models(args) {
  const config = loadConfig(args.config ? String(args.config) : undefined);
  const rows = publicModels(config);
  if (args.json) {
    console.log(JSON.stringify({ models: rows, routes: config.routes, defaultModel: config.defaultModel }, null, 2));
    return;
  }
  for (const model of rows) {
    console.log(
      `${model.id.padEnd(18)} ${model.label.padEnd(24)} ${model.provider}/${model.model}`
    );
    if (model.tasks.length > 0) console.log(`  tasks: ${model.tasks.join(', ')}`);
  }
  console.log('\nroutes:');
  for (const [task, modelId] of Object.entries(config.routes)) {
    console.log(`  ${task.padEnd(14)} -> ${modelId}`);
  }
}

function providers(args) {
  const query = String(args._[1] || '').toLowerCase();
  const rows = listProviders().filter(
    (provider) =>
      !query ||
      provider.id.toLowerCase().includes(query) ||
      provider.name.toLowerCase().includes(query)
  );
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const provider of rows) {
    console.log(
      `${provider.id.padEnd(28)} ${provider.protocol.padEnd(18)} ${provider.name}`
    );
  }
  console.log(`\n${rows.length} providers`);
}

async function chat(args) {
  const provider = String(args.provider || '').trim();
  const model = String(args.model || '').trim();
  const task = String(args.task || '').trim();
  const message = String(args.message || '').trim();
  if ((!model && !task) || !message) {
    throw new Error('chat requires --model or --task, plus --message');
  }
  const gateway = createGateway({
    configFile: args.config ? String(args.config) : undefined,
    defaultProvider: provider || undefined,
  });
  const messages = [];
  if (args.system) messages.push({ role: 'system', content: String(args.system) });
  messages.push({ role: 'user', content: message });
  let final = null;
  for await (const event of gateway.stream({
    provider,
    model,
    task,
    messages,
    apiKey: args['api-key'] ? String(args['api-key']) : undefined,
    baseURL: args['base-url'] ? String(args['base-url']) : undefined,
    protocol: args.protocol ? String(args.protocol) : undefined,
    allowNoKey: args['allow-no-key'] === true,
    allowUnlisted: args['allow-unlisted'] === true,
  })) {
    if (event.type === 'text.delta') {
      if (!args.json) process.stdout.write(event.text);
    } else if (event.type === 'reasoning.delta') {
      if (!args.json) process.stderr.write(event.text);
    } else if (event.type === 'tool_call.end') {
      if (!args.json) {
        console.error(`\n[tool] ${event.name} ${event.arguments}`);
      }
    } else if (event.type === 'done') {
      final = event;
    } else if (event.type === 'error') {
      throw Object.assign(new Error(event.error.message), event.error);
    }
  }
  if (args.json) {
    console.log(JSON.stringify(final, null, 2));
  } else {
    process.stdout.write('\n');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  if (command === 'help' || args.help) return help();
  if (command === 'serve') return serve(args);
  if (command === 'providers') return providers(args);
  if (command === 'models') return models(args);
  if (command === 'chat') return chat(args);
  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
