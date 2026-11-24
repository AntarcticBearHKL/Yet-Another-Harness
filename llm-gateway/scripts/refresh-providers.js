'use strict';

// Refresh the provider catalog from the same models.dev source OpenChamber
// and OpenCode use. Run when OpenChamber adds or renames providers.
//   node llm-gateway/scripts/refresh-providers.js

const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const response = await fetch('https://models.dev/api.json');
  if (!response.ok) throw new Error(`models.dev HTTP ${response.status}`);
  const data = await response.json();
  const providers = Object.entries(data)
    .map(([id, item]) => {
      const models = item && typeof item.models === 'object' ? item.models : {};
      const chatModels = Object.values(models).filter((model) => {
        const output = model?.modalities?.output;
        return !Array.isArray(output) || output.includes('text');
      });
      return {
        id,
        name: String(item?.name || id),
        api: String(item?.api || ''),
        env: Array.isArray(item?.env) ? item.env.map(String) : [],
        npm: String(item?.npm || ''),
        doc: String(item?.doc || ''),
        models: chatModels.length,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const file = path.join(__dirname, '..', 'src', 'providers.json');
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        source: 'https://models.dev/api.json',
        generatedAt: new Date().toISOString(),
        providers,
      },
      null,
      2
    )
  );
  console.log(`${file}: ${providers.length} providers`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
