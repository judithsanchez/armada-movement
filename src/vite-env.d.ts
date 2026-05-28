/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_MODE?: "true" | "false";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
