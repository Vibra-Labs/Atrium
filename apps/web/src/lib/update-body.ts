/**
 * The request body for `POST /updates`.
 *
 * Multipart only when there is actually a file to carry. The endpoint accepts
 * either, and always reaching for FormData is the kind of thing that reads as
 * an upload to anything deciding by content type — which is how posting a
 * plain text update started answering "Uploads are turned off in the demo."
 */
export function updateBody(content: string, attachment: File | null): FormData | string {
  if (!attachment) return JSON.stringify({ content });
  const form = new FormData();
  form.append("content", content);
  form.append("attachment", attachment);
  return form;
}
