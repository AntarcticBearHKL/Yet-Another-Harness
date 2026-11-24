'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const EXAMPLE_CONFIG_FILE = path.join(__dirname, '..', 'config.example.json');

const TASK_NAMES = [
  'chat',
  'manager',
  'lead',
  'research',
  'programmer',
  'tester',
  'writer',
  'reviewer',
];

function normalizeModel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || raw.alias || '').trim();
  const provider = String(raw.provider || '').trim();
  const model = String(raw.model || raw.modelId || '').trim();
  if (!id || !provider || !model) return null;
  return {
    id,
    label: String(raw.label || raw.name || id).trim() || id,
    description: String(raw.description || '').trim(),
    provider,
    model,
    tasks: Array.isArray(raw.tasks)
      ? [...new Set(raw.tasks.map((task) => String(task).trim()).filter(Boolean))]
      : [],
    baseURL: String(raw.baseURL || '').trim(),
    protocol: String(raw.protocol || '').trim(),
    headers:
      raw.headers && typeof raw.headers === 'object' ? { ...raw.headers } : {},
    providerOptions:
      raw.providerOptions && typeof raw.providerOptions === 'object'
        ? { ...raw.providerOptions }
        : {},
    apiKeyFromRequest: raw.apiKeyFromRequest === true,
  };
}

function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const models = (Array.isArray(source.models) ? source.models : [])
    .map(normalizeModel)
    .filter(Boolean);
  const byId = new Map(models.map((model) => [model.id, model]));
  const routes = {};
  if (source.routes && typeof source.routes === 'object') {
    for (const [task, modelId] of Object.entries(source.routes)) {
      const key = String(task || '').trim();
      const value = String(modelId || '').trim();
      if (key && byId.has(value)) routes[key] = value;
    }
  }
  const defaultModel = byId.has(String(source.defaultModel || '').trim())
    ? String(source.defaultModel).trim()
    : routes.chat || models[0]?.id || '';
  return {
    models,
    routes,
    defaultModel,
    tasks: TASK_NAMES,
  };
}

function loadConfig(file = process.env.YAH_LLM_CONFIG || DEFAULT_CONFIG_FILE) {
  const target = String(file || '').trim();
  if (!target) return normalizeConfig({});
  if (!fs.existsSync(target)) {
    if (target === DEFAULT_CONFIG_FILE && fs.existsSync(EXAMPLE_CONFIG_FILE)) {
      return loadConfig(EXAMPLE_CONFIG_FILE);
    }
    return normalizeConfig({});
  }
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(target, 'utf8')));
  } catch (error) {
    throw Object.assign(
      new Error(`failed to load gateway config ${target}: ${error.message}`),
      { code: 'invalid_gateway_config' }
    );
  }
}

function modelJson(model) {
  const out = {
    id: model.id,
    label: model.label,
    provider: model.provider,
    model: model.model,
  };
  if (model.description) out.description = model.description;
  if (model.tasks.length > 0) out.tasks = [...model.tasks];
  if (model.baseURL) out.baseURL = model.baseURL;
  if (model.protocol) out.protocol = model.protocol;
  if (Object.keys(model.headers).length > 0) out.headers = { ...model.headers };
  if (Object.keys(model.providerOptions).length > 0) {
    out.providerOptions = { ...model.providerOptions };
  }
  if (model.apiKeyFromRequest) out.apiKeyFromRequest = true;
  return out;
}

function configJson(config) {
  return {
    models: config.models.map(modelJson),
    routes: { ...config.routes },
    defaultModel: config.defaultModel,
  };
}

function saveConfig(file, raw, currentConfig = null) {
  const target = String(file || '').trim();
  if (!target) {
    throw Object.assign(new Error('gateway config file is not configured'), {
      code: 'missing_config_file',
    });
  }
  const current =
    currentConfig || (fs.existsSync(target) ? loadConfig(target) : normalizeConfig({}));
  const incoming = normalizeConfig(raw);
  const currentById = new Map(current.models.map((model) => [model.id, model]));
  const models = incoming.models.map((model) => {
    const existing = currentById.get(model.id);
    if (
      !existing ||
      existing.provider !== model.provider ||
      existing.model !== model.model
    ) {
      return model;
    }
    return {
      ...model,
      baseURL: existing.baseURL || model.baseURL,
      protocol: existing.protocol || model.protocol,
      headers:
        Object.keys(existing.headers).length > 0
          ? { ...existing.headers }
          : model.headers,
      providerOptions:
        Object.keys(existing.providerOptions).length > 0
          ? { ...existing.providerOptions }
          : model.providerOptions,
      apiKeyFromRequest:
        existing.apiKeyFromRequest || model.apiKeyFromRequest,
    };
  });
  const config = normalizeConfig({
    models,
    routes: incoming.routes,
    defaultModel: incoming.defaultModel,
  });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(configJson(config), null, 2)}\n`, 'utf8');
  fs.renameSync(temp, target);
  return config;
}

function modelById(config, id) {
  const key = String(id || '').trim();
  if (!key) return null;
  return config.models.find((model) => model.id === key) || null;
}

function resolveModel(config, request = {}) {
  const requested = String(request.model || '').trim();
  const direct = modelById(config, requested);
  if (direct) return direct;
  if (requested && request.allowUnlisted) {
    return {
      id: requested,
      label: requested,
      description: '',
      provider: String(request.provider || config.models[0]?.provider || ''),
      model: requested,
      tasks: [],
      baseURL: String(request.baseURL || ''),
      protocol: String(request.protocol || ''),
      headers: request.headers || {},
      providerOptions: request.providerOptions || {},
      apiKeyFromRequest: request.apiKeyFromRequest === true,
      unlisted: true,
    };
  }
  if (requested) return null;
  const task = String(request.task || '').trim();
  const routed = task ? config.routes[task] : '';
  if (routed) return modelById(config, routed);
  if (config.defaultModel) return modelById(config, config.defaultModel);
  if (config.models.length > 0) return config.models[0];
  return null;
}

function publicModels(config) {
  return config.models.map((model) => ({
    id: model.id,
    label: model.label,
    description: model.description,
    provider: model.provider,
    model: model.model,
    tasks: [...model.tasks],
  }));
}

module.exports = {
  DEFAULT_CONFIG_FILE,
  EXAMPLE_CONFIG_FILE,
  TASK_NAMES,
  normalizeConfig,
  normalizeModel,
  loadConfig,
  saveConfig,
  configJson,
  modelById,
  resolveModel,
  publicModels,
};
