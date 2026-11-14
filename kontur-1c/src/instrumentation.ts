// Старт фоновых сервисов «Контура 1С» вместе с сервером (Next.js instrumentation).
// Репликатор плана обмена (lib/bus/replicator.ts) поднимается здесь, чтобы
// водяная отметка зафиксировалась ДО любых прикладных записей журнала.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.DRIVER_BRIDGE_DISABLED === '1') return
  try {
    const { ensureBridgeReplicator } = await import('./lib/bus/replicator')
    ensureBridgeReplicator()
  } catch (e) {
    console.error('[bridge] не удалось запустить репликатор при старте:', e)
  }
}
