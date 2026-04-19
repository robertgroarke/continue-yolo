export async function fetchModels(
  _provider: string,
  _apiKey?: string,
  _apiBase?: string,
): Promise<string[]> {
  // This checkout references a fetchModels helper that is not present.
  // Returning an empty list keeps the extension buildable without affecting
  // the editor-tab/session behavior changes in this fork.
  return [];
}
