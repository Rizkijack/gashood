/**
 * Barrel tipe bersama (BUILD_STEPS.md Langkah 4).
 *
 * Single entry point untuk tipe yang dipakai lintas layer. Definisi TIDAK
 * dipindah ke sini — file ini hanya re-export dari sumber aslinya agar tidak
 * perlu menulis ulang import di banyak file yang sudah ada. Migrasi penuh
 * definisi tipe ke modul ini menyusul.
 *
 * Aman dari circular import: modul ini hanya bergantung pada
 * `@/data/tx-classifier`, `@/store/gas-store`, dan `viem` — tidak ada
 * yang meng-import balik `@/types`.
 */

// Sumber: src/data/tx-classifier.ts
export { TxType } from '@/data/tx-classifier'
import type { ClassifiedTransaction, TransactionData } from '@/data/tx-classifier'

export type { ClassifiedTransaction, TransactionData }

/** Alias sesuai penamaan dokumen (ARCHITECTURE.md / BUILD_STEPS.md). */
export type ClassifiedTx = ClassifiedTransaction
/** Transaksi mentah dari RPC (sebelum diklasifikasi + receipt). */
export type RawTransaction = TransactionData

// Sumber: viem — receipt dari RPC (rpc-client.ts)
export type { TransactionReceipt } from 'viem'

// Sumber: src/store/gas-store.ts
export type { GasMetric, NetworkStats } from '@/store/gas-store'
