import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { plog } from '@/lib/platform-log'
import type { ProfileDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** DTO проформы из записи Profile (может ещё не существовать) */
function toProfileDTO(p: {
  userId: string; fullName: string; position: string; phone: string; email: string
  companyName: string; inn: string; kpp: string; address: string; director: string; contactName: string; note: string
  updatedAt: Date
} | null): ProfileDTO {
  return p
    ? {
        userId: p.userId, fullName: p.fullName, position: p.position, phone: p.phone, email: p.email,
        companyName: p.companyName, inn: p.inn, kpp: p.kpp, address: p.address,
        director: p.director, contactName: p.contactName, note: p.note, updatedAt: p.updatedAt.toISOString(),
      }
    : {
        userId: '', fullName: '', position: '', phone: '', email: '',
        companyName: '', inn: '', kpp: '', address: '', director: '', contactName: '', note: '', updatedAt: '',
      }
}

/**
 * GET /api/profile — проформа текущего пользователя (Task 109).
 * У перевозчика данные компании предзаполняются из карточки Carrier.
 */
export async function GET() {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const profile = await db.profile.findUnique({ where: { userId: auth.id } })
  if (auth.role === 'carrier' && auth.carrierId) {
    const carrier = await db.carrier.findUnique({ where: { id: auth.carrierId } })
    if (carrier) {
      const p = profile ?? {
        userId: auth.id, fullName: '', position: '', phone: '', email: '',
        companyName: carrier.name, inn: carrier.inn, kpp: carrier.kpp, address: '',
        director: '', contactName: '', note: '', updatedAt: new Date(),
      }
      // карточка компании — источник истины: наименование/ИНН/КПП/телефон подставляются в проформу
      return NextResponse.json({
        profile: { ...toProfileDTO(p), companyName: carrier.name, inn: carrier.inn, kpp: carrier.kpp },
        role: auth.role,
        carrierRole: carrier.role === 'FORWARDER' ? 'FORWARDER' : 'CARRIER',
      })
    }
  }
  return NextResponse.json({ profile: toProfileDTO(profile), role: auth.role, carrierRole: null })
}

/**
 * PUT /api/profile — сохранить проформу текущего пользователя (Task 109).
 * У перевозчика наименование/ИНН/КПП/телефон синхронизируются с карточкой компании,
 * остальные поля проформы — персональные. Администрация правит профили через /api/admin/users.
 */
export async function PUT(req: NextRequest) {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })

  const data = {
    fullName: str(body.fullName, 200),
    position: str(body.position, 120),
    phone: str(body.phone, 40),
    email: str(body.email, 120),
    companyName: str(body.companyName, 200),
    inn: str(body.inn, 20),
    kpp: str(body.kpp, 20),
    address: str(body.address, 300),
    director: str(body.director, 200),
    contactName: str(body.contactName, 200),
    note: str(body.note, 1000),
  }

  const profile = await db.profile.upsert({
    where: { userId: auth.id },
    update: data,
    create: { userId: auth.id, ...data },
  })

  // реквизиты кабинета перевозчика обновляются вместе с проформой (единая карточка компании)
  if (auth.role === 'carrier' && auth.carrierId) {
    await db.carrier.update({
      where: { id: auth.carrierId },
      data: { name: data.companyName || 'Перевозчик', inn: data.inn, kpp: data.kpp, phone: data.phone },
    })
  }

  await plog({
    type: 'PROFILE_UPDATED', source: 'api/profile',
    actor: { login: auth.login, name: auth.name, role: auth.role },
    message: `Проформа заполнена: ${auth.name}`,
  })

  return NextResponse.json({ profile: toProfileDTO(profile) })
}
