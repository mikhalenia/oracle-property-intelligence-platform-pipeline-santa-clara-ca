import { createReadStream } from "node:fs";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { CID } from "multiformats/cid";

export type Uploader = {
  putFile(key: string, path: string, meta?: Record<string, string>): Promise<void>;
  /** CIDv1 base32 reported by the pinning service for `key`, or null if not reported in time. */
  headCid(key: string): Promise<string | null>;
};

export function filebaseUploader(env: { accessKey: string; secretKey: string; bucket: string }): Uploader {
  const client = new S3Client({
    endpoint: "https://s3.filebase.com",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: env.accessKey, secretAccessKey: env.secretKey },
  });
  return {
    async putFile(key, path, meta) {
      await new Upload({
        client,
        params: {
          Bucket: env.bucket,
          Key: key,
          Body: createReadStream(path),
          ...(meta ? { Metadata: meta } : {}),
        },
      }).done();
    },
    async headCid(key) {
      for (let i = 0; i < 10; i++) {
        const head = await client.send(new HeadObjectCommand({ Bucket: env.bucket, Key: key }));
        const cid = head.Metadata?.["cid"];
        if (cid) return CID.parse(cid).toV1().toString();
        await new Promise((r) => setTimeout(r, 3000));
      }
      return null;
    },
  };
}
