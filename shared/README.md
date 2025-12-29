# Model Configuration

This directory contains centralized configuration for the single AI model used by the app.

## Usage

To change the model, edit `/shared/model-config.js`. The change is reflected in:

- Backend AI logic (pricing, file support checks)
- API endpoints (billing and minimum balance checks)
- Any UI that references the model ID

## Configuration Structure

The model config includes:
- `id`: The provider model identifier (OpenRouter for now)
- `label`: Display name
- `note`: Description shown to users
- `multimodal`: Whether the model supports file attachments
- `pricing`: Input/output token costs per million tokens (used for billing)
- `pricingTiers` (optional): Tiered pricing based on prompt token count

## Example

```javascript
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
```
