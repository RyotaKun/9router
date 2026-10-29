export default {
  id: "azure",
  priority: 40,
  alias: "azure",
  display: {
    name: "Azure OpenAI",
    icon: "cloud",
    color: "#0078D4",
    textIcon: "AZ",
    website: "https://azure.microsoft.com/en-us/products/ai-services/openai-service",
    notice: {
      apiKeyUrl: "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI",
    },
  },
  category: "apikey",
  hasProviderSpecificData: true,
  serviceKinds: ["llm", "image"],
  models: [
    { id: "gpt-image-2", name: "GPT Image 2", kind: "image", params: ["n", "size", "quality"] },
  ],
  kindNotice: {
    image: "Use the gpt-image-2 Azure deployment connection. Text-to-image generation is supported; image editing is not enabled. Connections are shared with Azure chat.",
  },
  transport: {
    baseUrl: "",
    headers: {},
  },
};
