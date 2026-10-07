import { createReadStream } from "node:fs";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { CID } from "multiformats/cid";

export type Uploader = {
  putFile(key: string, path: string, meta?: Record<string, string>): Promise<void>;
  /** CIDv1 base32 reported by the pinning service for `key`; throws if none is reported in time. */
  headCid(key: string): Promise<string>;
};

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

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
      let waited = 0;
      for (let i = 0; i < 20; i++) {
        const head = await client
          .send(new HeadObjectCommand({ Bucket: env.bucket, Key: key }))
          .catch((err: unknown) => {
            if (isNotFound(err)) return undefined;
            throw err;
          });
        const cid = head?.Metadata?.["cid"];
        if (cid) return CID.parse(cid).toV1().toString();
        const delay = Math.min(15_000, 3_000 + i * 1_000);
        waited += delay;
        await new Promise((r) => setTimeout(r, delay));
      }
      throw new Error(
        `pinning service did not report a CID for ${key} within ${Math.round(waited / 1000)} s`,
      );
    },
  };
}
