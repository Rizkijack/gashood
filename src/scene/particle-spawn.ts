/**
 * Seleksi tx baru untuk spawn partikel — pure & headless-testable.
 *
 * Diekstrak dari useFrame GasParticles agar aturan spawn bisa dikunci test:
 * jangan PERNAH pakai `recentTxs.length` sebagai tracker — ring buffer
 * tercap di MAX_RECENT_TXS (200), length berhenti bertambah, dan spawn
 * mati permanen (bug yang sudah pernah terjadi).
 *
 * recentTxs diurutkan newest-first (karena store menambahkan tx baru di depan).
 *
 * Aturan:
 *  - recentTxs kosong                     → [] (hash tersimpan dipertahankan pemanggil).
 *  - recentTxs[0].hash === lastHash       → [] (tidak ada tx baru, buffer full sekalipun).
 *  - lastHash masih ada di buffer         → semua tx lebih baru dari lastHash (prefiks, exclusive).
 *  - lastHash sudah tergusur (>200 tx baru sejak frame lalu) → seluruh buffer
 *    dianggap baru (full-scan — degradasi aman, duplikat sekali, tidak pernah berhenti).
 *  - lastHash null (mount pertama)        → seluruh buffer.
 */
export function selectNewTxs<T extends { hash: string }>(
  recentTxs: T[],
  lastHash: string | null,
): T[] {
  if (recentTxs.length === 0) return []
  if (recentTxs[0].hash === lastHash) return []
  const out: T[] = []
  for (const tx of recentTxs) {
    if (tx.hash === lastHash) break
    out.push(tx)
  }
  return out
}
