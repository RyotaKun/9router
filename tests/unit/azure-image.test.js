import { describe, it, expect, vi, afterEach } from "vitest";
import adapter from "../../open-sse/handlers/imageProviders/azure.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const credentials = { apiKey: "test-secret", providerSpecificData: {
  azureEndpoint: "https://sample.services.ai.azure.com", deployment: "gpt-image-2",
} };
describe("Azure images", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("routes Foundry resources to the image deployment with image API version", () => {
    expect(adapter.buildUrl("gpt-image-2", credentials)).toBe("https://sample.cognitiveservices.azure.com/openai/deployments/gpt-image-2/images/generations?api-version=2025-04-01-preview");
  });
  it("supports an explicit v1 endpoint", () => {
    expect(adapter.buildUrl("gpt-image-2", { providerSpecificData: { azureEndpoint: "https://sample.openai.azure.com/openai/v1/" } })).toBe("https://sample.openai.azure.com/openai/v1/images/generations");
  });
  it("rejects missing, insecure, credentialed and ambiguous endpoints", () => {
    for (const azureEndpoint of [undefined, "http://sample", "https://user:pass@sample", "https://sample?key=secret", "https://sample/models"]) {
      expect(() => adapter.buildUrl("gpt-image-2", { providerSpecificData: { azureEndpoint } })).toThrow();
    }
  });
  it("does not send an image request to another Azure deployment", () => {
    expect(() => adapter.buildUrl("another-model", credentials)).toThrow(/does not match/);
  });
  it("uses api-key and omits unsupported fields", () => {
    expect(adapter.buildHeaders(credentials)).toEqual({ "Content-Type": "application/json", "api-key": "test-secret" });
    expect(adapter.buildBody("gpt-image-2", { prompt: "box", n: 1, quality: "high", response_format: "b64_json", stream: true })).toEqual({ model: "gpt-image-2", prompt: "box", n: 1, quality: "high" });
  });
  it("returns base64 images and usage through the real image core", async () => {
    const payload = { created: 123, data: [{ b64_json: "aW1hZ2U=" }], usage: { total_tokens: 42 } };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
    vi.stubGlobal("fetch", fetch);
    const result = await handleImageGenerationCore({ body: { prompt: "box", n: 1 }, modelInfo: { provider: "azure", model: "gpt-image-2" }, credentials });
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual(payload);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers["api-key"]).toBe("test-secret");
  });
});
