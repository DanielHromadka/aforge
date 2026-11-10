import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const bucket = process.env.AFORGE_MEDIA_BUCKET
const client = bucket ? new S3Client({ endpoint: process.env.AFORGE_MEDIA_ENDPOINT, region: 'auto', credentials: { accessKeyId: process.env.AFORGE_MEDIA_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.AFORGE_MEDIA_SECRET_ACCESS_KEY ?? '' } }) : undefined

/** Private R2/S3 media bypass the application proxy. Authorize before issuing a short-lived URL. */
export const mediaUrl = async (key: string, file: string, contentType: string, disposition?: string) => {
  if (!client || !bucket) return undefined
  const size = (await stat(file)).size
  let found = false
  try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); found = true }
  catch (e) { if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw e }
  if (!found) await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(file), ContentLength: size, ContentType: contentType, CacheControl: 'private, no-store', ContentDisposition: disposition }))
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: contentType, ResponseCacheControl: 'private, no-store', ResponseContentDisposition: disposition }), { expiresIn: 120 })
}
