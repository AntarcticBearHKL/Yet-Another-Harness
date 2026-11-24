'use strict';

// Run the gateway first:
//   cd llm-gateway && npm start
// Then:
//   node llm-gateway/examples/yah-client.js deepseek deepseek-chat "Hello"

const { streamYahChat } = require('../src/client');

const [provider = 'deepseek', model = 'deepseek-chat', ...words] = process.argv.slice(2);
const prompt = words.join(' ') || 'Say hello in one sentence.';

(async () => {
  const done = await streamYahChat({
    endpoint: process.env.YAH_LLM_GATEWAY || 'http://127.0.0.1:8790',
    request: {
      provider,
      model,
      messages: [{ role: 'user', content: prompt }],
    },
    onEvent(event) {
      if (event.type === 'text.delta') process.stdout.write(event.text);
      else if (event.type === 'reasoning.delta') process.stderr.write(event.text);
      else if (event.type === 'tool_call.end') {
        console.error(`\n[tool] ${event.name} ${event.arguments}`);
      }
    },
  });
  process.stdout.write('\n');
  if (done?.usage) console.error('usage', done.usage);
})().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
