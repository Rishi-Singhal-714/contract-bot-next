import { getSupabase } from './supabaseClient';
import { config } from './config';

export async function uploadBuffer(
  bucket: string,
  path: string,
  data: Buffer,
  contentType = 'application/pdf'
) {
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(bucket).upload(path, data, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload failed (${bucket}/${path}): ${error.message}`);
  return path;
}

export async function downloadBuffer(bucket: string, path: string): Promise<Buffer> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`Supabase download failed (${bucket}/${path}): ${error.message}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export const buckets = {
  templates: config.templatesBucket,
  attachments: config.attachmentsBucket,
  exports: config.exportsBucket,
};
