# Reasoning Models Support

This document explains the support for AI reasoning/thinking models (like OpenAI's o1/o3 series) in aicommits.

## Overview

Reasoning models like OpenAI's o1, o1-preview, o1-mini, and o3-mini have different API requirements compared to standard chat models. This implementation automatically detects reasoning models and adjusts API calls accordingly.

## Key Features

### 1. Automatic Model Detection

The system automatically detects reasoning models based on their name:
- Models starting with `o1` (e.g., o1-preview, o1-mini)
- Models starting with `o3` (e.g., o3-mini)

### 2. Parameter Adjustments for Reasoning Models

When a reasoning model is detected, the following adjustments are made:

#### System Message Transformation
Reasoning models don't support system messages. System messages are automatically converted to user messages with a prefix:
```typescript
{ role: 'system', content: 'You are helpful' }
// Becomes:
{ role: 'user', content: 'System instructions: You are helpful' }
```

#### Unsupported Parameters Removed
The following parameters are NOT sent to reasoning models:
- `temperature`
- `top_p`
- `frequency_penalty`
- `presence_penalty`

#### Reasoning Effort Parameter
Instead of temperature, reasoning models support a `reasoning_effort` parameter with values:
- `low` - Faster responses with less reasoning
- `medium` - Balanced reasoning and speed (default)
- `high` - More thorough reasoning, slower responses

## Configuration

### Adding Reasoning Effort to Your Config

You can set the reasoning effort in your aicommits configuration:

```bash
# Using CLI
aicommits config set reasoning-effort high

# Or edit ~/.aicommits.yaml directly
profiles:
  default:
    provider: openai
    model: o1-preview
    reasoningEffort: high
    apiKey: your-api-key
    baseUrl: https://api.openai.com/v1
```

### Supported Values
- `low` - Quick reasoning
- `medium` - Balanced (default)
- `high` - Deep reasoning

## Usage Examples

### Basic Setup with o1 Model

```yaml
profiles:
  default:
    provider: openai
    model: o1-preview
    reasoningEffort: medium
    apiKey: sk-...
    baseUrl: https://api.openai.com/v1
```

### Using Different Reasoning Levels

For quick commits:
```yaml
reasoningEffort: low
```

For complex changes requiring deeper analysis:
```yaml
reasoningEffort: high
```

## Provider Support

### OpenAI
✅ Full support for o1/o3 models with automatic parameter adjustment

### Anthropic
✅ Interface updated to accept `reasoningEffort` parameter (for future extended thinking support)

### Ollama
✅ Interface updated to accept `reasoningEffort` parameter (parameter is accepted but not used)

## Technical Implementation

### Files Modified

1. **`src/utils/config.ts`**
   - Added `reasoningEffort` to config schema
   - Added to `configKeys` array

2. **`src/services/ai-provider.interface.ts`**
   - Added `ReasoningEffort` type
   - Updated `generateCompletion` and `streamCompletion` interfaces

3. **`src/services/openai-provider.ts`**
   - Added `isReasoningModel()` helper function
   - Added `prepareMessagesForReasoningModel()` to convert system messages
   - Updated `generateCompletion()` to handle reasoning models
   - Updated `streamCompletion()` to handle reasoning models
   - Updated `listModels()` to include o1/o3 models

4. **`src/services/anthropic-provider.ts`**
   - Updated to accept `reasoningEffort` parameter

5. **`src/services/ollama-provider.ts`**
   - Updated to accept `reasoningEffort` parameter

6. **`src/services/ai-commit-message.service.ts`**
   - Updated to pass `reasoningEffort` from config to providers

### Tests

Added comprehensive tests in `src/services/openai-provider.spec.ts`:
- Model listing includes o1/o3 models
- System message transformation for reasoning models
- Reasoning effort parameter handling
- Streaming with reasoning models

## Best Practices

1. **Use `high` reasoning effort for:**
   - Complex refactoring commits
   - Multi-file changes
   - Critical production code

2. **Use `medium` reasoning effort for:**
   - Regular feature development
   - Bug fixes
   - Standard commits

3. **Use `low` reasoning effort for:**
   - Simple typo fixes
   - Documentation updates
   - Quick iterations

## Troubleshooting

### Error: "Invalid reasoning_effort parameter"
Make sure you're using one of the valid values: `low`, `medium`, or `high`

### Model not recognized as reasoning model
Check that your model name starts with `o1` or `o3`. If using a custom model, it won't be detected as a reasoning model unless it follows this naming convention.

### System messages not working
This is expected behavior for reasoning models. System messages are automatically converted to user messages with a "System instructions:" prefix.

## Future Enhancements

Potential areas for future improvement:
- Anthropic extended thinking prompt patterns
- Configurable system message transformation format
- Model-specific reasoning effort defaults
- Usage tracking for reasoning tokens
