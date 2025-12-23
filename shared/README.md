# Model Configuration

This directory contains centralized configuration for AI model tiers.

## Usage

To change a model tier, edit `/shared/model-config.js`. The changes will automatically be reflected everywhere in the app:

- Frontend UI (model dropdown in App.tsx)
- Backend AI logic (pricing, file support checks)
- API endpoints (billing, free tier detection)

## Configuration Structure

Each model tier has:
- `id`: The OpenRouter model identifier
- `label`: Display name for the UI dropdown
- `note`: Description shown to users
- `multimodal`: Whether the model supports file attachments
- `pricing`: Input/output token costs per million tokens (used for billing)
- `maxAttachments`: Maximum number of files this tier can process
- `maxAttachmentTokens`: Token budget for file content

## Example

To change Tier 1 from Gemini to a different model:

```javascript
{
  id: 'anthropic/claude-3-haiku',  // Change this
  label: 'Tier 1 — Budget multimodal',
  note: 'Budget multimodal; good default for using attachments without heavy spend.',
  multimodal: true,
  pricing: { in: 0.25, out: 1.25 },  // Update pricing
  maxAttachments: 5,
  maxAttachmentTokens: 8000
}
```

The change will automatically update:
- UI dropdown and descriptions
- Pricing calculations in the backend
- File support detection
- Token limits for file processing
