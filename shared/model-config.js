/**
 * Centralized model configuration for AI tiers.
 * Change models here and they'll be reflected everywhere in the app.
 */

export const MODEL_TIERS = [
  {
    id: 'allenai/olmo-3.1-32b-think:free',
    label: 'Tier 0 — Free (text-only)',
    note: 'Free text-only; no attachments. Paste important file content into descriptions.',
    multimodal: false,
    pricing: { in: 0, out: 0 }
  },
  {
    id: 'google/gemini-2.5-flash-lite',
    label: 'Tier 1 — Budget multimodal',
    note: 'Budget multimodal; good default for using attachments without heavy spend.',
    multimodal: true,
    pricing: { in: 0.1, out: 0.4 }
  },
  {
    id: 'openai/gpt-5-mini',
    label: 'Tier 2 — Strong multimodal',
    note: 'Stronger multimodal; better for complex tasks and mixed attachments.',
    multimodal: true,
    pricing: { in: 0.25, out: 2 }
  },
  {
    id: 'google/gemini-2.5-pro',
    label: 'Tier 3 — Premium multimodal',
    note: 'Premium multimodal; best for big attachments and deep breakdowns.',
    multimodal: true,
    pricing: { in: 1.25, out: 10 }
  }
];

// Helper functions for easy access
export const getModelById = (modelId) => MODEL_TIERS.find((t) => t.id === modelId);
export const getDefaultModel = () => MODEL_TIERS[0];
export const isFreeModel = (modelId) => {
  const tier = getModelById(modelId);
  if (!tier) return false;
  return !tier.multimodal || (tier.pricing.in === 0 && tier.pricing.out === 0);
};
export const supportsFiles = (modelId) => getModelById(modelId)?.multimodal ?? false;
export const getPricing = (modelId) => getModelById(modelId)?.pricing ?? { in: 0, out: 0 };
export const getTierIndex = (modelId) => MODEL_TIERS.findIndex((t) => t.id === modelId);

// Create price map for backward compatibility
export const priceMap = Object.fromEntries(
  MODEL_TIERS.map((tier) => [tier.id, tier.pricing])
);
