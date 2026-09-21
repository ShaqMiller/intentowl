/**
 * Plain operator email through Resend.
 *
 * Separate from the digest sender because an alert has no React template and
 * must stay deliverable when the digest code is the thing that is broken.
 * Never throws: it reports failure, and the caller decides whether that fails
 * its job.
 */
import { Resend } from "resend";

export interface PlainEmailOptions {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}

export async function sendPlainEmail(
  options: PlainEmailOptions,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const { data, error } = await new Resend(options.apiKey).emails.send({
      from: options.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
    });
    if (error !== null) return { ok: false, error: `${error.name}: ${error.message}` };
    return data?.id === undefined ? { ok: true } : { ok: true, id: data.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
