import { AZURE_IMAGE_API_VERSION, AZURE_IMAGE_BODY_FIELDS } from "../../config/azureImage.js";

export default {
  buildUrl(model, credentials) {
    const cfg = credentials?.providerSpecificData || {};
    if (!cfg.azureEndpoint) throw new Error("Azure image connection requires azureEndpoint");
    const url = new URL(cfg.azureEndpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("Azure image endpoint must be an HTTPS URL without credentials, query or fragment");
    }
    const deployment = cfg.deployment || model;
    if (deployment !== model) throw new Error("Azure image deployment does not match requested model");
    // Foundry resource host -> Azure OpenAI deployment endpoint.
    url.hostname = url.hostname.replace(/\.services\.ai\.azure\.com$/, ".cognitiveservices.azure.com");
    const path = url.pathname.replace(/\/$/, "");
    if (path === "/openai/v1") {
      url.pathname = `${path}/images/generations`;
    } else if (!path || path === "/") {
      url.pathname = `/openai/deployments/${encodeURIComponent(deployment)}/images/generations`;
      url.searchParams.set("api-version", cfg.imageApiVersion || AZURE_IMAGE_API_VERSION);
    } else {
      throw new Error("Azure image endpoint must be a resource root or /openai/v1");
    }
    return url.toString();
  },
  buildHeaders(credentials) {
    if (!credentials?.apiKey) throw new Error("Azure image connection requires an API key");
    return { "Content-Type": "application/json", "api-key": credentials.apiKey };
  },
  buildBody(model, body) {
    const result = { model };
    for (const field of AZURE_IMAGE_BODY_FIELDS) {
      if (body[field] !== undefined) result[field] = body[field];
    }
    // GPT Image returns base64; response_format and chat-only options are not supported.
    return result;
  },
  normalize: (body) => body,
};
