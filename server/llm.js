'use strict';

const fs = require('node:fs');
const path = require('node:path');
const store = require('../src/store');
const {
  loadConfig,
  saveConfig,
  publicModels,
} = require('../llm-gateway/src/config');

const EXAMPLE_FILE = path.join(__dirname, '..', 'llm-gateway', 'config.example.json');
const LEGACY_FILE = path.join(__dirname, '..', 'llm-gateway', 'config.json');

function configFile() {
  const override = String(process.env.YAH_LLM_CONFIG || '').trim();
  if (override) return path.resolve(override);
  return store.dataPath('llm.json');
}

function ensureConfigFile(file) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const seed = fs.existsSync(LEGACY_FILE)
    ? LEGACY_FILE
    : fs.existsSync(EXAMPLE_FILE)
      ? EXAMPLE_FILE
      : '';
  if (seed) fs.copyFileSync(seed, file);
}

function viewOf(config, file) {
  return {
    ok: true,
    configFile: file,
    models: publicModels(config),
    routes: { ...config.routes },
    defaultModel: config.defaultModel,
    tasks: [...config.tasks],
  };
}

function getConfig() {
  const file = configFile();
  ensureConfigFile(file);
  return loadConfig(file);
}

function view() {
  const file = configFile();
  ensureConfigFile(file);
  return viewOf(loadConfig(file), file);
}

function save(raw) {
  const file = configFile();
  ensureConfigFile(file);
  const config = saveConfig(file, raw, loadConfig(file));
  return viewOf(config, file);
}

module.exports = {
  configFile,
  getConfig,
  view,
  save,
};
