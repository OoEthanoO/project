/**
 * Centralized AI model configuration.
 * Change the model here and it will be reflected everywhere in the app.
 */

export const MODEL_TIERS = [
  {
    id: 'google/gemini-3-pro-preview',
    label: 'Gemini 3 Pro Preview',
    note: 'Gemini 3 Pro Preview via OpenRouter; supports attachments.',
    multimodal: true,
    pricing: { in: 2, out: 12 },
    pricingTiers: [
      { maxPromptTokens: 200000, maxCompletionTokens: 200000, in: 2, out: 12 },
      { maxPromptTokens: Infinity, maxCompletionTokens: Infinity, in: 4, out: 18 }
    ]
  }
];

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
