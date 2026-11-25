import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Presigned URLs for Lodging confirmation files in the private data bucket (Req 6.4, 6.5). */
export interface ConfirmationStore {
  uploadTarget(key: string, contentType: string): Promise<{ url: string; fields: Record<string, string> }>;
  downloadUrl(key: string): Promise<string>;
}

export const MAX_CONFIRMATION_BYTES = 10 * 1024 * 1024;

export function createS3ConfirmationStore(
  client: S3Client = new S3Client({}),
  bucket: string | undefined = process.env.DATA_BUCKET,
): ConfirmationStore {
  const Bucket = (): string => {
    if (!bucket) throw new Error('DATA_BUCKET is not configured');
    return bucket;
  };
  return {
    // POST policy: 5 minutes, exact key and content type, at most 10 MB.
    uploadTarget: (key, contentType) =>
      createPresignedPost(client, {
        Bucket: Bucket(),
        Key: key,
        Fields: { 'Content-Type': contentType },
        Conditions: [
          ['content-length-range', 1, MAX_CONFIRMATION_BYTES],
          ['eq', '$Content-Type', contentType],
        ],
        Expires: 300,
      }),
    downloadUrl: (key) => getSignedUrl(client, new GetObjectCommand({ Bucket: Bucket(), Key: key }), { expiresIn: 900 }),
  };
}
