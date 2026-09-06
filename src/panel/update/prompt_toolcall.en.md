# Response format

Choose how the model returns variable updates. This setting is saved with the API profile.

- **Chat message:** The most compatible option. Start here if you are unsure what your provider
  supports. Successful updates depend on the model following the prompt.
- **Tool call:** Requires the model and provider to support tool calling, also called function
  calling. It usually reduces interference from unrelated prose.
- **Structured output:** Requires JSON Schema support. It constrains the response format to make
  variable updates more reliable.
- **Structured output (v4 compatible):** For providers that support JSON Object but not JSON Schema,
  such as dsv4f. Available for Custom and supported More sources.

Try Structured output if your provider explicitly supports JSON Schema. Use Structured output (v4
compatible) for JSON Object support, or try Tool call when tool calling is available.

Model capability hints are a guide. If a request reports that the format is unsupported, choose
another format or check the provider, API URL, and model name. MVU does not switch formats
automatically.
