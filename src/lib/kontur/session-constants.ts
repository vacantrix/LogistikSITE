// Имена cookie диспетчерской. Вынесены в отдельный модуль без Prisma,
// чтобы общий выход платформы мог гасить сессию Контура, не загружая
// второй Prisma-клиент.
export const SESSION_COOKIE = 'aemz_dispatch_session'
export const SESSION_COOKIE_PATH = '/kontur'
