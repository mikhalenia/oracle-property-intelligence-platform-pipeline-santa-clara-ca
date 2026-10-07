import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      MANIFEST_GATEWAY: string;
      TEST_MIGRATIONS: D1Migration[];
    }
    interface GlobalProps {
      mainModule: typeof import("./index");
    }
  }
}

export {};
