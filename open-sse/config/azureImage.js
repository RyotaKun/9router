// Azure image deployments use a different API version from chat deployments.
export const AZURE_IMAGE_API_VERSION = "2025-04-01-preview";
export const AZURE_IMAGE_BODY_FIELDS = [
  "prompt", "n", "size", "quality", "background", "output_format",
  "output_compression", "moderation", "user",
];
