# Response format

The response format determines which capabilities the AI provider must support for extra-model
parsing and how reliably MVU can read the variable updates.

- **Chat message:** Offers the widest compatibility and requires no additional provider features.
  Reliability depends on whether the model follows the requested format.
- **Tool call:** Requires tools/function-calling support. It usually reduces interference from
  prose. If the target endpoint or model rejects tool calling, the request reports a clear error and
  does not fall back automatically.
- **Structured output:** Requires JSON Schema structured-output support. **Custom** sources use the
  OpenAI-compatible `response_format.json_schema`; **More** sources encode it using the selected
  API's wire format. This is usually the best option for JsonPatch variable updates because the
  response is constrained to structured JSON.
- **Structured output (v4 compatible):** For providers, such as dsv4f, that support JSON Object
  output but not JSON Schema structured output. This mode is available for **Custom** sources and
  for APIs under **More** that support JSON Object output.

When **More** is selected, MVU optimistically sends tool-calling or structured-output requests using
the selected API's wire format; it does not probe the target endpoint or model first. If the target
rejects the request, MVU reports a clear error through toastr and does not downgrade. Choose a
response format the target supports, or check the API type, URL, and model name.

If your provider explicitly supports JSON Schema structured output, try **Structured output** first.
If it supports only JSON Object output, use **Structured output (v4 compatible)**. You can also try
**Tool call** when the provider supports tools/function calling; otherwise use **Chat message**.
