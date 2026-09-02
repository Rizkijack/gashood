/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL: string
  readonly VITE_BLOCKSCOUT_API_URL: string
  readonly VITE_POLLING_INTERVAL: string
  readonly VITE_MAX_RECENT_TXS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
