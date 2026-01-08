/**
 * Centralized AI model configuration.
 * Change the model here and it will be reflected everywhere in the app.
 */

const GEMINI_PRICING = { in: 2, out: 12 };
const GEMINI_PRICING_TIERS = [
  { maxPromptTokens: 200000, maxCompletionTokens: 200000, in: 2, out: 12 },
  { maxPromptTokens: Infinity, maxCompletionTokens: Infinity, in: 4, out: 18 }
];
const GEMINI_BASE_MODEL = 'google/gemini-3-pro-preview';
export const MODEL_TIERS = [
  {
    id: `${GEMINI_BASE_MODEL}:online`,
    label: 'Gemini 3 Pro Preview',
    note: 'Gemini 3 Pro Preview via OpenRouter; supports attachments and web search.',
    multimodal: true,
    pricing: GEMINI_PRICING,
    pricingTiers: GEMINI_PRICING_TIERS
  },
  {
    id: GEMINI_BASE_MODEL,
    label: 'Gemini 3 Pro Preview (web search off)',
    note: 'Gemini 3 Pro Preview via OpenRouter; supports attachments.',
    multimodal: true,
    pricing: GEMINI_PRICING,
    pricingTiers: GEMINI_PRICING_TIERS
  }
];

const ONLINE_SUFFIX = ':online';

export const hasOnlineSuffix = (modelId = '') => modelId.endsWith(ONLINE_SUFFIX);
export const stripOnlineSuffix = (modelId = '') => modelId.replace(/:online\b/g, '');
export const ensureOnlineSuffix = (modelId = '') => {
  if (!modelId) return modelId;
  const base = stripOnlineSuffix(modelId);
  return base.endsWith(ONLINE_SUFFIX) ? base : `${base}${ONLINE_SUFFIX}`;
};
export const applyWebSearchSetting = (modelId, enabled) => {
  if (!modelId) return modelId;
  if (typeof enabled !== 'boolean') return modelId;
  return enabled ? ensureOnlineSuffix(modelId) : stripOnlineSuffix(modelId);
};

// Helper functions for easy access
export const getModelById = (modelId) => MODEL_TIERS.find((t) => t.id === modelId);
export const getDefaultModel = () => MODEL_TIERS[0];
export const isFreeModel = (modelId) => {
  const tier = getModelById(modelId);
  if (!tier) return false;
  return tier.pricing.in === 0 && tier.pricing.out === 0;
};
export const supportsFiles = (modelId) => getModelById(modelId)?.multimodal ?? false;
export const getPricing = (modelId) => getModelById(modelId)?.pricing ?? { in: 0, out: 0 };
export const getPricingForUsage = (modelId, promptTokens = 0, completionTokens = 0) => {
  const tier = getModelById(modelId);
  if (!tier) return { in: 0, out: 0 };
  const tiers = tier.pricingTiers || [];
  if (Array.isArray(tiers) && tiers.length > 0) {
    const inputTier = tiers.find((t) => promptTokens <= t.maxPromptTokens);
    const outputTier = tiers.find((t) => completionTokens <= (t.maxCompletionTokens ?? t.maxPromptTokens));
    if (inputTier || outputTier) {
      return {
        in: (inputTier || outputTier).in,
        out: (outputTier || inputTier).out
      };
    }
  }
  return tier.pricing ?? { in: 0, out: 0 };
};
export const isValidModel = (modelId) => MODEL_TIERS.some((t) => t.id === modelId);
export const getValidModelOrDefault = (modelId) => isValidModel(modelId) ? modelId : getDefaultModel().id;

// Create price map for backward compatibility
export const priceMap = Object.fromEntries(
  MODEL_TIERS.map((tier) => [tier.id, tier.pricing])
);
