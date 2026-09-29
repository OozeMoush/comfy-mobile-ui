# ComfyUI workflow

Export the workflow you want this app to drive in **API format** and save it as:

`server/workflows/base.json`

The bridge currently expects the API-format workflow to contain:

- one `KSampler` or `KSamplerAdvanced`
- the sampler's `positive` input linked to a text node with an input named `text`
- the sampler's `negative` input linked to a text node with an input named `text`
- an image-producing output such as `SaveImage`

The bridge replaces the positive prompt, negative prompt and seed before submitting the workflow to ComfyUI.
