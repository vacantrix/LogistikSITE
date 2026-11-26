/**
 * Edge-версия инструментарии — пустая: вся Node-логика (журнал, таймеры
 * торгов, data-fixes) в instrumentation-nodejs.ts. Пустой edge-файл нужен,
 * чтобы компиляция Edge Instrumentation не тянула fs/path из lib и не
 * ломала сборку страницы (Next 16.4.6, Turbopack).
 */
export async function register(): Promise<void> {
  // в edge-ране не делаем ничего
}
