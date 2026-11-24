'use strict';

module.exports = {
  ...require('./gateway'),
  ...require('./catalog'),
  ...require('./client'),
  ...require('./server'),
  protocols: {
    openaiChat: require('./protocols/openai-chat'),
    openaiResponses: require('./protocols/openai-responses'),
    anthropic: require('./protocols/anthropic'),
    gemini: require('./protocols/gemini'),
    cohere: require('./protocols/cohere'),
    azure: require('./protocols/azure'),
    bedrock: require('./protocols/bedrock'),
  },
};
